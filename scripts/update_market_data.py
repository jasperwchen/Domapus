"""Monthly housing-data pipeline.

Fetches Redfin + Zillow, merges with ZCTA metadata, emits the columnar JSON
the frontend consumes. Fails loud on schema drift, network errors, or all-null
output columns — the GitHub Action's failure handler then opens an issue.
"""
import gzip
import json
import logging
import random
import re
import sys
import tempfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import pandas as pd
import requests

# generate_lite_data is imported lazily inside main() so the module remains
# importable from anywhere (e.g. `from scripts.update_market_data import ...`
# in tests) regardless of whether scripts/ is on sys.path.

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "public" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

LOG_PATH = Path(tempfile.gettempdir()) / "data_pipeline.log"
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s: %(message)s',
    handlers=[logging.FileHandler(LOG_PATH, 'w'), logging.StreamHandler()],
)


class PipelineError(RuntimeError):
    """Raised on any condition that should fail the workflow loudly."""


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------
def load_zip_mapping_data(file_path=None):
    file_path = file_path or DATA_DIR / "zcta-meta.csv"
    logging.info(f"Loading ZIP mapping from {file_path}...")
    try:
        df = pd.read_csv(file_path, dtype={'zcta': str})
    except FileNotFoundError as e:
        raise PipelineError(f"ZIP mapping file missing: {file_path}") from e
    df.set_index('zcta', inplace=True)
    return df.to_dict('index')


def download_file(url, label, save_path=None, timeout=300):
    """Download a URL. Returns bytes (or True if save_path), or raises PipelineError."""
    logging.info(f"Downloading {label}...")
    try:
        if save_path:
            Path(save_path).parent.mkdir(parents=True, exist_ok=True)
            with requests.get(url, stream=True, timeout=timeout) as r:
                r.raise_for_status()
                with open(save_path, 'wb') as f:
                    for chunk in r.iter_content(chunk_size=65536):
                        f.write(chunk)
            return True
        response = requests.get(url, timeout=timeout)
        response.raise_for_status()
        return response.content
    except requests.RequestException as e:
        raise PipelineError(f"Download failed for {label} ({url}): {e}") from e


# ---------------------------------------------------------------------------
# Zillow
# ---------------------------------------------------------------------------
def process_zillow_data(content):
    logging.info("Processing Zillow ZHVI data...")
    df = pd.read_csv(BytesIO(content), dtype={'RegionName': str})

    if 'RegionName' not in df.columns:
        raise PipelineError("Zillow CSV missing 'RegionName' column — schema drift")

    date_cols = sorted([c for c in df.columns if re.match(r'\d{4}-\d{2}-\d{2}', c)])
    if len(date_cols) < 13:
        raise PipelineError(f"Zillow CSV has only {len(date_cols)} date columns; need >=13 for MoM/YoY")

    curr, mom, yoy = date_cols[-1], date_cols[-2], date_cols[-13]
    results = {}

    for _, row in df.iterrows():
        zip_code = row['RegionName'].zfill(5)
        val = row[curr]
        val_mom = row[mom]
        val_yoy = row[yoy]

        if pd.isna(val):
            continue

        results[zip_code] = {
            'zhvi': round(float(val), 2),
            'zhvi_mom': round(((val / val_mom) - 1), 3) if val_mom and val_mom != 0 else None,
            'zhvi_yoy': round(((val / val_yoy) - 1), 3) if val_yoy and val_yoy != 0 else None,
        }
    logging.info(f"Zillow: processed {len(results)} ZIPs")
    return results


# ---------------------------------------------------------------------------
# Redfin
# ---------------------------------------------------------------------------
def extract_zip_code(region_str):
    if pd.isna(region_str):
        return None
    match = re.search(r'Zip Code:\s*(\d{5})', str(region_str))
    return match.group(1) if match else None


def get_full_column_mapping():
    return {
        'PERIOD_END': 'period_end',
        'MEDIAN_SALE_PRICE': 'median_sale_price', 'MEDIAN_SALE_PRICE_MOM': 'median_sale_price_mom', 'MEDIAN_SALE_PRICE_YOY': 'median_sale_price_yoy',
        'MEDIAN_LIST_PRICE': 'median_list_price', 'MEDIAN_LIST_PRICE_MOM': 'median_list_price_mom', 'MEDIAN_LIST_PRICE_YOY': 'median_list_price_yoy',
        'MEDIAN_PPSF': 'median_ppsf', 'MEDIAN_PPSF_MOM': 'median_ppsf_mom', 'MEDIAN_PPSF_YOY': 'median_ppsf_yoy',
        'HOMES_SOLD': 'homes_sold', 'HOMES_SOLD_MOM': 'homes_sold_mom', 'HOMES_SOLD_YOY': 'homes_sold_yoy',
        'PENDING_SALES': 'pending_sales', 'PENDING_SALES_MOM': 'pending_sales_mom', 'PENDING_SALES_YOY': 'pending_sales_yoy',
        'NEW_LISTINGS': 'new_listings', 'NEW_LISTINGS_MOM': 'new_listings_mom', 'NEW_LISTINGS_YOY': 'new_listings_yoy',
        'INVENTORY': 'inventory', 'INVENTORY_MOM': 'inventory_mom', 'INVENTORY_YOY': 'inventory_yoy',
        'MEDIAN_DOM': 'median_dom', 'MEDIAN_DOM_MOM': 'median_dom_mom', 'MEDIAN_DOM_YOY': 'median_dom_yoy',
        'AVG_SALE_TO_LIST': 'avg_sale_to_list_ratio', 'AVG_SALE_TO_LIST_MOM': 'avg_sale_to_list_mom', 'AVG_SALE_TO_LIST_YOY': 'avg_sale_to_list_ratio_yoy',
        'SOLD_ABOVE_LIST': 'sold_above_list', 'SOLD_ABOVE_LIST_MOM': 'sold_above_list_mom', 'SOLD_ABOVE_LIST_YOY': 'sold_above_list_yoy',
        'OFF_MARKET_IN_TWO_WEEKS': 'off_market_in_two_weeks', 'OFF_MARKET_IN_TWO_WEEKS_MOM': 'off_market_in_two_weeks_mom', 'OFF_MARKET_IN_TWO_WEEKS_YOY': 'off_market_in_two_weeks_yoy',
    }


def process_redfin_data(temp_redfin_file, col_map):
    """Stream the TSV, keep one row per ZIP (the latest PERIOD_END)."""
    use_cols = list(col_map.keys()) + ['REGION']

    # Validate schema against the first chunk before processing everything
    with gzip.open(temp_redfin_file, 'rt') as f:
        header = pd.read_csv(f, sep='\t', nrows=0)
        missing = [c for c in use_cols if c not in header.columns]
        if missing:
            raise PipelineError(
                f"Redfin TSV missing expected columns (schema drift): {missing}. "
                f"Available: {sorted(header.columns.tolist())}"
            )

    best_so_far = pd.DataFrame()
    with gzip.open(temp_redfin_file, 'rt') as f:
        reader = pd.read_csv(f, sep='\t', chunksize=100_000, usecols=use_cols)
        for chunk in reader:
            chunk['zip_code'] = chunk['REGION'].apply(extract_zip_code)
            chunk = chunk.dropna(subset=['zip_code'])
            chunk['PERIOD_END'] = pd.to_datetime(chunk['PERIOD_END'])
            # Per-chunk dedup keeps memory bounded; final dedup picks the global latest.
            chunk = chunk.sort_values('PERIOD_END').drop_duplicates('zip_code', keep='last')
            combined = pd.concat([best_so_far, chunk], ignore_index=True) if not best_so_far.empty else chunk
            best_so_far = combined.sort_values('PERIOD_END').drop_duplicates('zip_code', keep='last')

    logging.info(f"Redfin: kept latest record for {len(best_so_far)} ZIPs")
    return {row['zip_code']: row.to_dict() for _, row in best_so_far.iterrows()}


# ---------------------------------------------------------------------------
# Assembly + validation
# ---------------------------------------------------------------------------
KEY_ORDER = [
    'city', 'county', 'state', 'metro', 'lat', 'lng', 'period_end',
    'zhvi', 'zhvi_mom', 'zhvi_yoy',
    'median_sale_price', 'median_sale_price_mom', 'median_sale_price_yoy',
    'median_list_price', 'median_list_price_mom', 'median_list_price_yoy',
    'median_ppsf', 'median_ppsf_mom', 'median_ppsf_yoy',
    'homes_sold', 'homes_sold_mom', 'homes_sold_yoy',
    'pending_sales', 'pending_sales_mom', 'pending_sales_yoy',
    'new_listings', 'new_listings_mom', 'new_listings_yoy',
    'inventory', 'inventory_mom', 'inventory_yoy',
    'median_dom', 'median_dom_mom', 'median_dom_yoy',
    'avg_sale_to_list_ratio', 'avg_sale_to_list_mom', 'avg_sale_to_list_ratio_yoy',
    'sold_above_list', 'sold_above_list_mom', 'sold_above_list_yoy',
    'off_market_in_two_weeks', 'off_market_in_two_weeks_mom', 'off_market_in_two_weeks_yoy',
]


def _coerce_value(key, val):
    if val is None or pd.isna(val) or val == "":
        return None
    try:
        if key == 'period_end':
            return val.strftime('%Y-%m-%d') if hasattr(val, 'strftime') else str(val)[:10]
        if key in ('lat', 'lng'):
            return round(float(val), 5)
        if key == 'median_ppsf':
            return round(float(val), 2)
        if key == 'avg_sale_to_list_ratio':
            return round(float(val) * 100, 1)
        if any(x in key for x in ('_mom', '_yoy', 'sold_above_list', 'off_market_in_two_weeks')):
            if 'dom' in key:
                return round(float(val), 1)
            return round(float(val) * 100, 1)
        if any(c in key for c in ('price', 'sold', 'inventory', 'dom', 'listings', 'pending', 'zhvi')):
            return int(float(val))
        return val
    except (ValueError, TypeError):
        return None


def assemble_output(zip_mapping, zillow_data, redfin_records):
    output = {}
    max_period_end = None

    for zip_code, zm in zip_mapping.items():
        raw = {
            'city': zm.get('city'), 'county': zm.get('county'),
            'state': zm.get('state'), 'metro': zm.get('metro'),
            'lat': zm.get('lat'), 'lng': zm.get('lng'),
        }
        col_map = get_full_column_mapping()
        redfin_dict = redfin_records.get(zip_code, {})
        if redfin_dict:
            raw.update({col_map.get(k, k): v for k, v in redfin_dict.items()})
        if zip_code in zillow_data:
            raw.update(zillow_data[zip_code])

        ordered = {}
        for key in KEY_ORDER:
            ordered[key] = _coerce_value(key, raw.get(key))

        pe = ordered.get('period_end')
        if pe and (max_period_end is None or pe > max_period_end):
            max_period_end = pe

        output[zip_code] = ordered

    return output, max_period_end


def validate_output(output):
    """Reject empty or obviously broken assemblies before they reach the frontend."""
    if not output:
        raise PipelineError("Output is empty — no ZIPs assembled")

    # Every column should have at least one non-null value; an all-null column
    # almost always means an input column was renamed and silently dropped.
    null_columns = []
    for key in KEY_ORDER:
        if all(record.get(key) is None for record in output.values()):
            null_columns.append(key)
    if null_columns:
        raise PipelineError(
            f"All-null output columns detected (likely input schema drift): {null_columns}"
        )

    logging.info(f"Output validation passed: {len(output)} ZIPs, {len(KEY_ORDER)} columns")


def compare_against_existing(zip_data_path, output_data):
    """Return (old_timestamp, zip_codes_changed, data_points_changed)."""
    if not zip_data_path.exists():
        return None, 0, 0

    try:
        with open(zip_data_path, 'r') as f:
            old_payload = json.load(f)
    except Exception as e:
        logging.warning(f"Could not read existing zip-data.json: {e}")
        return None, 0, 0

    old_timestamp = old_payload.get('last_updated_utc')

    if 'f' in old_payload and 'z' in old_payload and 'd' in old_payload:
        fields = old_payload['f']
        old_data = {z: dict(zip(fields, old_payload['d'][i]))
                    for i, z in enumerate(old_payload['z'])}
    elif 'zip_codes' in old_payload:
        old_data = old_payload['zip_codes']
    else:
        return old_timestamp, 0, 0

    new_zips = set(output_data.keys())
    old_zips = set(old_data.keys())
    changed = new_zips ^ old_zips
    data_points_changed = 0

    for z in new_zips & old_zips:
        if output_data[z] != old_data[z]:
            changed.add(z)
            for k, v in output_data[z].items():
                if v != old_data[z].get(k):
                    data_points_changed += 1

    return old_timestamp, len(changed), data_points_changed


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    logging.info("--- Starting Data Pipeline Run ---")
    zip_mapping = load_zip_mapping_data()
    if not zip_mapping:
        raise PipelineError("ZIP mapping data is empty")

    zillow_url = "https://files.zillowstatic.com/research/public_csvs/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
    zillow_content = download_file(zillow_url, "Zillow")
    zillow_data = process_zillow_data(zillow_content)
    if not zillow_data:
        raise PipelineError("Zillow processing returned no records")

    redfin_url = "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz"
    temp_redfin_file = DATA_DIR / "redfin_temp.tsv.gz"
    download_file(redfin_url, "Redfin", save_path=temp_redfin_file)

    try:
        latest_records = process_redfin_data(temp_redfin_file, get_full_column_mapping())
    finally:
        if temp_redfin_file.exists():
            temp_redfin_file.unlink()

    if not latest_records:
        raise PipelineError("Redfin processing returned no records")

    output_data, max_period_end = assemble_output(zip_mapping, zillow_data, latest_records)
    validate_output(output_data)

    if output_data:
        random_zip = random.choice(list(output_data.keys()))
        logging.info(f"VERIFICATION - Random ZIP ({random_zip}): {json.dumps(output_data[random_zip], indent=2)}")

    zip_data_path = DATA_DIR / "zip-data.json"
    old_timestamp, zip_codes_changed, data_points_changed = compare_against_existing(zip_data_path, output_data)

    # Build columnar payload, preserving timestamp when nothing changed
    zip_list = sorted(output_data.keys())
    data_rows = [[output_data[z].get(field) for field in KEY_ORDER] for z in zip_list]

    current_timestamp = datetime.now(timezone.utc).isoformat()
    changed = zip_codes_changed > 0 or data_points_changed > 0
    timestamp_to_use = current_timestamp if (old_timestamp is None or changed) else old_timestamp

    columnar_output = {
        "last_updated_utc": timestamp_to_use,
        "f": KEY_ORDER,
        "z": zip_list,
        "d": data_rows,
    }

    with open(zip_data_path, 'w', encoding='utf-8') as f:
        json.dump(columnar_output, f, separators=(",", ":"))

    # Only rewrite last_updated.json when something actually changed (or on first run).
    # Previously this was always rewritten with now(), so the UI's "Data Updated" date
    # advanced even on no-op runs.
    last_updated_path = DATA_DIR / "last_updated.json"
    if changed or not last_updated_path.exists():
        with open(last_updated_path, 'w') as f:
            json.dump({
                "last_updated_utc": current_timestamp,
                "period_end": max_period_end,
                "total_zip_codes": len(output_data),
                "zip_codes_changed": zip_codes_changed,
                "data_points_changed": data_points_changed,
            }, f, indent=2)
    else:
        logging.info("No data changes — leaving last_updated.json intact")

    logging.info("Generating lite data file...")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from generate_lite_data import generate_lite_data  # noqa: E402  (lazy import, see top of file)
    generate_lite_data(zip_data_path)

    logging.info(f"Run completed. Processed {len(output_data)} ZIP codes "
                 f"({zip_codes_changed} changed, {data_points_changed} data points changed).")


if __name__ == "__main__":
    try:
        main()
    except PipelineError as e:
        logging.error(f"Pipeline failed: {e}")
        sys.exit(1)
