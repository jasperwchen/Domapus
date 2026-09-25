"""Acquisition: HEAD probe, download, integrity.

- No range-GET for data: S3 returns the whole-object ETag on a 206, so a partial download
  could not be verified.
- MD5-vs-ETag applies to Redfin only. Zillow's ETag is multipart (MD5 of MD5s).
"""

import csv
import hashlib
import logging
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

from .contracts import PipelineError

log = logging.getLogger(__name__)

REDFIN_URL = (
    "https://redfin-public-data.s3.us-west-2.amazonaws.com/"
    "redfin_data_center/housing_market/monthly/all_zips.csv"
)
ZHVI_URL = (
    "https://files.zillowstatic.com/research/public_csvs/zhvi/"
    "Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
)

# Redirects elsewhere are treated as a supply-chain event.
ALLOWED_HOSTS = {
    "redfin-public-data.s3.us-west-2.amazonaws.com",
    "files.zillowstatic.com",
}

PROBE_BYTES = 1 << 20
CHUNK = 1 << 20
# requests' timeout bounds gaps between reads, not total time; these bound a trickle.
MAX_ELAPSED_S = 45 * 60
MIN_THROUGHPUT_BPS = 200_000


def _check_host(url: str, label: str) -> None:
    host = urlparse(url).hostname
    if host not in ALLOWED_HOSTS:
        raise PipelineError(
            f"{label}: final URL host {host!r} is not allowlisted. Got {url!r}."
        )


def probe(url: str, label: str) -> dict:
    """HEAD plus a 1 MB shape probe. Cheap; nothing derived from it is published."""
    r = requests.head(url, timeout=60, allow_redirects=True)
    r.raise_for_status()
    _check_host(r.url, label)

    # Streamed and capped: a server that ignores Range answers 200 with the whole file.
    with requests.get(url, timeout=120, stream=True,
                      headers={"Range": f"bytes=0-{PROBE_BYTES - 1}"}) as head:
        head.raise_for_status()
        _check_host(head.url, label)
        body = head.raw.read(PROBE_BYTES, decode_content=True)
    # Only the first two lines are decoded: the 1 MB cut can split a multi-byte character.
    lines = [ln.decode("utf-8", errors="strict").rstrip("\r")
             for ln in body.split(b"\n", 2)[:2]]

    info = {
        "url": url,
        "etag": (r.headers.get("ETag") or "").strip('"'),
        "last_modified": r.headers.get("Last-Modified"),
        "content_length": int(r.headers.get("Content-Length") or 0),
        "header": lines[0] if lines else "",
        "first_row": lines[1] if len(lines) > 1 else "",
        "probe_sha256": hashlib.sha256(body).hexdigest(),
    }
    log.info(
        "%s probe: %s bytes, ETag %s, Last-Modified %s",
        label, f"{info['content_length']:,}", info["etag"][:12], info["last_modified"],
    )
    return info


def probe_header(info: dict) -> list[str]:
    """The probe's `header` line as column names.

    `info["header"]` is the file's first line verbatim, and Redfin quotes every field, so
    splitting on commas leaves `'"LAST UPDATED"'` and matches nothing. pyarrow strips the
    quotes when it reads the real file, so anything comparing the probed header against the
    ingested one has to strip them the same way.
    """
    return next(csv.reader([info["header"]]), [])


def download(url: str, dest: Path, label: str, expect_bytes: int | None = None,
             verify_md5: str | None = None) -> dict:
    """Stream to disk with a total-elapsed watchdog and a throughput floor."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    md5 = hashlib.md5()
    start = time.monotonic()
    got = 0

    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        _check_host(r.url, label)
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=CHUNK):
                if not chunk:
                    continue
                f.write(chunk)
                md5.update(chunk)
                got += len(chunk)
                elapsed = time.monotonic() - start
                if elapsed > MAX_ELAPSED_S:
                    raise PipelineError(
                        f"{label}: exceeded {MAX_ELAPSED_S}s total after {got:,} bytes"
                    )
                if elapsed > 60 and got / elapsed < MIN_THROUGHPUT_BPS:
                    raise PipelineError(
                        f"{label}: throughput fell to {got / elapsed / 1000:.0f} kB/s "
                        f"(floor {MIN_THROUGHPUT_BPS / 1000:.0f} kB/s) — connection stalled"
                    )

    digest = md5.hexdigest()
    if expect_bytes is not None and got != expect_bytes:
        raise PipelineError(
            f"{label}: downloaded {got:,} bytes, HEAD said {expect_bytes:,}"
        )
    if verify_md5:
        if digest != verify_md5:
            raise PipelineError(
                f"{label}: md5 {digest} does not match the ETag {verify_md5}. "
                f"The file changed mid-download or the transfer is corrupt."
            )
        log.info("%s: md5 verified against ETag", label)

    log.info("%s: %s bytes in %.0fs", label, f"{got:,}", time.monotonic() - start)
    return {"bytes": got, "md5": digest, "seconds": round(time.monotonic() - start, 1)}


def fetch_bytes(url: str, label: str) -> bytes:
    """Whole-body GET for the small source. No MD5 contract — see module docstring."""
    r = requests.get(url, timeout=600)
    r.raise_for_status()
    _check_host(r.url, label)
    if len(r.content) < 1000:
        raise PipelineError(f"{label}: body is only {len(r.content)} bytes")
    return r.content


def is_multipart_etag(etag: str) -> bool:
    """`<hex>-<n>` means a multipart upload: an MD5-of-MD5s, never the body digest."""
    return "-" in etag


def fingerprint(probe_info: dict) -> str:
    """Identity of the upstream bytes. Excludes Last-Modified and LAST UPDATED, which change
    on republish without content changing."""
    parts = "|".join(str(probe_info.get(k, "")) for k in
                     ("etag", "content_length", "probe_sha256", "first_row"))
    return hashlib.sha256(parts.encode("utf-8")).hexdigest()[:16]
