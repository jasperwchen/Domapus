"""`run()` start to finish, offline, on a generated release.

Generated rather than cut from the feed: `serialize.validate` refuses a period more than 120
days old, so a committed file would start failing within months, and the stages need more
than the 13 x 11 sample (noise fits lags 1-7, classing needs 14 rankable ZIPs, spatial a
k = 32 graph). The ZIPs, their metadata and their geometry are real (60 Denver ZCTAs). The
values are drawn to the shapes the stages assume: prices that rise with latitude and
longitude, so Moran's I has clusters to find; log sale price noise of K / sqrt(sales) with
K = 0.6; and every feed YoY computed from the published levels in the feed's own units
(percent, points, whole days, months x 100), so the scale vote and the reconciliation agree.
"""

import csv
import json
import shutil
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pytest

import pipeline.__main__ as main
from pipeline import serialize, sources

ROOT = Path(__file__).resolve().parent.parent
HEADER_SOURCE = ROOT / "tests" / "fixtures" / "redfin_sample_2026_08.csv"
PERIODS = 16
ZHVI_MONTHS = 96
K = 0.6


def _month_end(d: date) -> date:
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def _months_back(end: date, n: int) -> date:
    y, m = divmod(end.year * 12 + end.month - 1 - n, 12)
    return _month_end(date(y, m + 1, 1))


def _denver(n: int) -> list[dict]:
    geo = {r["ZCTA5CE20"] for r in csv.DictReader(
        (ROOT / "public" / "data" / "zcta-geom.csv").open(encoding="utf-8"))}
    rows = [r for r in csv.DictReader((ROOT / "public" / "data" / "zcta-meta.csv").open(encoding="utf-8"))
            if r["metro"] == "Denver, CO" and r["zcta"] in geo]
    return rows[:n]


def _levels(rng, meta):
    """[period][zip] -> {key: published value}, rounded as the feed rounds them."""
    lat = np.array([float(r["lat"]) for r in meta])
    lng = np.array([float(r["lng"]) for r in meta])
    gradient = 0.5 * (lat - lat.mean()) / lat.std() + 0.3 * (lng - lng.mean()) / lng.std()
    base = {}
    for i, r in enumerate(meta):
        base[r["zcta"]] = {
            "n": int(np.exp(rng.uniform(np.log(8), np.log(320)))),
            "mu": np.log(600_000) + gradient[i] + rng.normal(0, 0.1),
            "sqft": rng.uniform(1_100, 2_600),
            "dom": rng.uniform(8, 80),
            "s2l": rng.uniform(96, 104),
            "abv": rng.uniform(5, 65),
            "om2": rng.uniform(10, 60),
        }
    out = []
    for t in range(PERIODS):
        row = {}
        for z, b in base.items():
            n = max(1, int(round(b["n"] * rng.uniform(0.85, 1.15))))
            msp = int(round(np.exp(b["mu"] + 0.003 * t + rng.normal(0, K / np.sqrt(n)))))
            inv = max(1, int(round(n * rng.uniform(0.7, 1.4))))
            row[z] = {
                "homes_sold": n,
                "median_sale_price": msp,
                "median_ppsf": round(msp / b["sqft"], 2),
                "median_dom": int(round(b["dom"] * rng.uniform(0.8, 1.2))),
                "avg_sale_to_list_ratio": round(b["s2l"] + rng.normal(0, 0.5), 2),
                "sold_above_list": round(min(99.0, max(0.0, b["abv"] + rng.normal(0, 3))), 1),
                "new_listings": max(1, int(round(n * rng.uniform(1.1, 1.5)))),
                "active_listings": max(1, int(round(n * rng.uniform(2.0, 3.0)))),
                "inventory": inv,
                "pending_sales": max(1, int(round(n * rng.uniform(0.9, 1.2)))),
                "median_list_price": int(round(msp * rng.uniform(1.0, 1.08))),
                "median_list_ppsf": round(msp / b["sqft"] * rng.uniform(1.0, 1.08), 2),
                "months_of_supply": round(inv / (n / 3), 1),
                "off_market_in_two_weeks": round(min(99.0, b["om2"] + rng.normal(0, 3)), 2),
            }
        out.append(row)
    return out


# Feed header -> (our key, how its YoY is published). Levels use the key alone.
YOY_KIND = {
    "HOMES SOLD YOY (%)": ("homes_sold", "pct"),
    "MEDIAN SALE PRICE NSA YOY (%)": ("median_sale_price", "pct"),
    "MEDIAN DAYS ON MARKET YOY (DAYS)": ("median_dom", "days"),
    "AVERAGE SALE TO LIST RATIO YOY (PPTS)": ("avg_sale_to_list_ratio", "ppts"),
    "SHARE SOLD ABOVE ORIGINAL LIST YOY (PPTS)": ("sold_above_list", "ppts"),
    "NEW LISTINGS YOY (%)": ("new_listings", "pct"),
    "ACTIVE LISTINGS YOY (%)": ("active_listings", "pct"),
    "INVENTORY YOY (%)": ("inventory", "pct"),
    "PENDING SALES YOY (%)": ("pending_sales", "pct"),
    "MEDIAN NEW LISTING PRICE YOY (%)": ("median_list_price", "pct"),
    "MEDIAN NEW LISTING PRICE PER SQ.FT. YOY (%)": ("median_list_ppsf", "pct"),
    "MEDIAN SALE PRICE PER SQ.FT. YOY (%)": ("median_ppsf", "pct"),
    "MONTHS OF SUPPLY YOY (%)": ("months_of_supply", "mos_x100"),
    "PERCENT OFF MARKET IN TWO WEEKS YOY (PPTS)": ("off_market_in_two_weeks", "ppts"),
}
LEVEL_OF = {
    "HOMES SOLD": "homes_sold",
    "MEDIAN SALE PRICE NSA ($)": "median_sale_price",
    "MEDIAN DAYS ON MARKET (DAYS)": "median_dom",
    "AVERAGE SALE TO LIST RATIO (%)": "avg_sale_to_list_ratio",
    "SHARE SOLD ABOVE ORIGINAL LIST (%)": "sold_above_list",
    "NEW LISTINGS": "new_listings",
    "ACTIVE LISTINGS": "active_listings",
    "INVENTORY": "inventory",
    "PENDING SALES": "pending_sales",
    "MEDIAN NEW LISTING PRICE ($)": "median_list_price",
    "MEDIAN NEW LISTING PRICE PER SQ.FT. ($)": "median_list_ppsf",
    "MEDIAN SALE PRICE PER SQ.FT. ($)": "median_ppsf",
    "MONTHS OF SUPPLY": "months_of_supply",
    "PERCENT OFF MARKET IN TWO WEEKS (%)": "off_market_in_two_weeks",
}


def _yoy(kind: str, now, before) -> str:
    if kind == "pct":
        return f"{(now / before - 1.0) * 100.0:.2f}"
    if kind == "ppts":
        return f"{now - before:.2f}"
    if kind == "days":
        return f"{now - before:.0f}"
    return f"{(now - before) * 100.0:.2f}"


def _write_month(d: Path, header, zips, levels, zhvi, latest: date, keep: int) -> dict:
    """The feed as it stood when period `keep - 1` was the newest."""
    ends = [_months_back(latest, PERIODS - 1 - t) for t in range(keep)]
    newest = ends[-1]
    redfin_csv = d / f"redfin-{newest:%Y-%m}.csv"
    with redfin_csv.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        # Newest first, as the feed ships it; ingest refuses any other order.
        for t, end in reversed(list(enumerate(ends))):
            begin = _months_back(end, 2).replace(day=1)
            for i, z in enumerate(zips):
                cells = {
                    "LAST UPDATED": (newest + timedelta(days=3)).isoformat(),
                    "FREQUENCY": "Rolling 3 Months",
                    "PERIOD BEGIN": begin.isoformat(), "PERIOD END": end.isoformat(),
                    "REGION ID": str(9000 + i), "REGION TYPE": "Zip", "REGION NAME": z,
                    "METRO": "Denver, CO metro area",
                }
                for h, key in LEVEL_OF.items():
                    cells[h] = str(levels[t][z][key])
                for h, (key, kind) in YOY_KIND.items():
                    cells[h] = (_yoy(kind, levels[t][z][key], levels[t - 12][z][key])
                                if t >= 12 else "NA")
                w.writerow([cells.get(h, "NA") for h in header])

    months = ZHVI_MONTHS - (PERIODS - keep)
    zhvi_csv = d / f"zhvi-{newest:%Y-%m}.csv"
    with zhvi_csv.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["RegionID", "RegionName",
                    *(_months_back(newest, months - 1 - m).isoformat() for m in range(months))])
        for i, z in enumerate(zips):
            w.writerow([str(7000 + i), z, *(f"{x:.0f}" for x in zhvi[z][:months])])
    return {"redfin": redfin_csv, "zhvi": zhvi_csv}


@pytest.fixture(scope="module")
def release(tmp_path_factory) -> dict:
    """Two consecutive monthly feeds ending last month, plus trimmed ZCTA inputs."""
    d = tmp_path_factory.mktemp("release")
    rng = np.random.default_rng(20260924)
    meta = _denver(60)
    zips = [r["zcta"] for r in meta]
    latest = _month_end(date.today().replace(day=1) - timedelta(days=1))
    levels = _levels(rng, meta)
    zhvi = {
        z: np.exp(np.log(levels[0][z]["median_sale_price"] * 0.8)
                  + np.cumsum(rng.uniform(0.001, 0.006) + rng.normal(0, 0.004, ZHVI_MONTHS)))
        for z in zips
    }
    header = HEADER_SOURCE.read_text(encoding="utf-8").splitlines()[0].split(",")

    with (d / "zcta-meta.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(meta[0]))
        w.writeheader()
        w.writerows(meta)
    src = (ROOT / "public" / "data" / "zcta-geom.csv").read_text(encoding="utf-8").splitlines()
    keep = set(zips)
    (d / "zcta-geom.csv").write_text(
        "\n".join([src[0], *(l for l in src[1:] if l.split(",")[0] in keep)]) + "\n",
        encoding="utf-8",
    )
    return {
        "dir": d, "header": header,
        "previous": _write_month(d, header, zips, levels, zhvi, latest, PERIODS - 1),
        "current": _write_month(d, header, zips, levels, zhvi, latest, PERIODS),
    }


@pytest.fixture
def site(tmp_path, release, monkeypatch) -> Path:
    """`run()` pointed at a scratch build/ and public/data/, with the generated inputs."""
    public = tmp_path / "public" / "data"
    public.mkdir(parents=True)
    monkeypatch.setattr(main, "BUILD", tmp_path / "build")
    monkeypatch.setattr(main, "LIVE_SNAPSHOT", public / "zip-data.json")
    monkeypatch.setattr(main, "LIVE_MANIFEST", public / "manifest.json")
    monkeypatch.setattr(main, "ZCTA_META", release["dir"] / "zcta-meta.csv")
    monkeypatch.setattr(main, "ZCTA_GEOM", release["dir"] / "zcta-geom.csv")
    return tmp_path


def _built(site: Path) -> tuple[dict, dict]:
    build = site / "build"
    return (json.loads((build / "manifest.json").read_text(encoding="utf-8")),
            json.loads((build / "zip-data.json").read_text(encoding="utf-8")))


def _run_and_publish(site: Path, feed: dict) -> tuple[dict, dict]:
    assert main.run(feed["redfin"], feed["zhvi"], skip_probe=True) == 0
    for name in ("zip-data.json", "manifest.json"):
        shutil.copy(site / "build" / name, site / "public" / "data" / name)
    return _built(site)


def _fake_upstream(monkeypatch, header: list[str]) -> dict:
    """Probes that answer without the network, and downloads that must not happen."""
    probes = {label: {"etag": f"{label}-etag", "content_length": 1234,
                      "probe_sha256": label, "first_row": label,
                      "header": ",".join(f'"{h}"' for h in header)}
              for label in ("redfin", "zhvi")}
    url_label = {sources.REDFIN_URL: "redfin", sources.ZHVI_URL: "zhvi"}
    monkeypatch.setattr(sources, "probe", lambda url, label: probes[url_label[url]])

    def no_network(*_a, **_k):
        raise AssertionError("the run tried to download")
    monkeypatch.setattr(sources, "download", no_network)
    monkeypatch.setattr(sources, "fetch_bytes", no_network)
    return {label: sources.fingerprint(p) for label, p in probes.items()}


def test_a_first_run_builds_every_stage(site, release):
    assert main.run(release["current"]["redfin"], release["current"]["zhvi"], skip_probe=True) == 0

    receipts = {p.stem.removesuffix("_report"): json.loads(p.read_text(encoding="utf-8"))["status"]
                for p in (site / "build").glob("*_report.json")}
    assert receipts == {s: "ok" for s in (
        "s0_probe", "s1_acquire", "s2_ingest", "s3_assemble", "s4_gate", "s5_noise",
        "s5b_forecast", "s5c_spatial", "s6_classify", "s7_paint", "s8_history")}

    manifest, snap = _built(site)
    # No live release: nothing to compare against, so it publishes.
    assert manifest["content_changed"] is True and manifest["previous_content_digest"] is None
    for asset in manifest["assets"]["paint"].values():
        assert (site / "build" / asset["file"]).exists()
    assert snap["f"] == serialize.SNAPSHOT_COLUMNS
    assert len(snap["z"]) == 60


def test_a_same_month_rebuild_keeps_the_holds_and_the_digest(site, release):
    """Last month, this month, then this month again: what a `force_rebuild` dispatch does.

    The rebuild must not treat the live release as last month. If it did, it would release
    every hold early and change the digest over unchanged data, and the workflow would
    commit and deploy a release that differs only in which outliers are drawn."""
    _run_and_publish(site, release["previous"])
    manifest, snap = _run_and_publish(site, release["current"])
    held = manifest["spatial"]["held"]
    assert held, "the fixture no longer produces a hold, so this test proves nothing"

    assert main.run(release["current"]["redfin"], release["current"]["zhvi"], skip_probe=True) == 0
    again, rebuilt = _built(site)
    assert again["spatial"]["held"] == held
    lisa = serialize.SNAPSHOT_COLUMNS.index("lisa")
    assert rebuilt["d"][lisa] == snap["d"][lisa]
    assert again["content_digest"] == manifest["content_digest"]
    assert again["content_changed"] is False


def test_an_unchanged_upstream_exits_before_downloading(site, release, monkeypatch):
    fingerprints = _fake_upstream(monkeypatch, release["header"])
    (site / "public" / "data" / "manifest.json").write_text(
        json.dumps({"fingerprints": fingerprints}), encoding="utf-8")

    assert main.run(None, None, skip_probe=False) == 0
    assert [p.name for p in (site / "build").iterdir()] == ["s0_probe_report.json"]
    s0 = json.loads((site / "build" / "s0_probe_report.json").read_text(encoding="utf-8"))
    assert s0["unchanged"] is True


def test_a_local_file_never_carries_upstreams_fingerprint(site, release, monkeypatch):
    """A local Redfin file is not what upstream serves now. Stamping upstream's fingerprint on
    it made the next scheduled run believe it already had the current release."""
    fingerprints = _fake_upstream(monkeypatch, release["header"])
    zhvi_bytes = release["current"]["zhvi"].read_bytes()
    monkeypatch.setattr(sources, "fetch_bytes", lambda url, label: zhvi_bytes)
    (site / "public" / "data" / "manifest.json").write_text(
        json.dumps({"fingerprints": {"redfin": "older", "zhvi": "older"}}), encoding="utf-8")

    assert main.run(release["current"]["redfin"], None, skip_probe=False) == 0
    assert _built(site)[0]["fingerprints"] == {"zhvi": fingerprints["zhvi"]}
