"""Acquisition: HEAD probe, download, integrity.

Two decisions here are load-bearing and both were argued the other way first.

**Range-GET is rejected for data.** At ~8 MB per period the lag-12 endpoint sits
~97 MB into the file and the full panel needs all 173 periods, so a 20 MB range
buys raw levels and nothing else. Worse, S3 returns the *whole-object* ETag on a
206, so a ranged path would carry a digest that cannot verify the bytes actually
received — a silently-dead integrity check, which is the exact failure mode the
data-safety rules forbid. The full download is ~60 s on a runner. One 1 MB shape
probe survives, and nothing derived from it is published.

**MD5-vs-ETag is scoped to Redfin only.** Zillow's ETag ends `-12`: it is a
multipart upload, so it is an MD5-of-MD5s and can never equal the body digest.
A generic check would fail every run or, worse, be quietly skipped. Zillow gets
Content-Length plus the structural assertions in zhvi.py instead.
"""

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

# The final URL after redirects must be one of these. A redirect to somewhere
# else is a supply-chain event, not a transient error.
ALLOWED_HOSTS = {
    "redfin-public-data.s3.us-west-2.amazonaws.com",
    "files.zillowstatic.com",
}

PROBE_BYTES = 1 << 20
CHUNK = 1 << 20
# requests' timeout caps the gap between reads, not total elapsed time, so a
# stalled-but-trickling connection can hang forever under it. These two are the
# actual bounds.
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

    head = requests.get(url, timeout=120, headers={"Range": f"bytes=0-{PROBE_BYTES - 1}"})
    head.raise_for_status()
    _check_host(head.url, label)
    text = head.content.decode("utf-8", errors="strict")
    lines = text.splitlines()

    info = {
        "url": url,
        "etag": (r.headers.get("ETag") or "").strip('"'),
        "last_modified": r.headers.get("Last-Modified"),
        "content_length": int(r.headers.get("Content-Length") or 0),
        "header": lines[0] if lines else "",
        "first_row": lines[1] if len(lines) > 1 else "",
        "probe_sha256": hashlib.sha256(head.content).hexdigest(),
    }
    log.info(
        "%s probe: %s bytes, ETag %s, Last-Modified %s",
        label, f"{info['content_length']:,}", info["etag"][:12], info["last_modified"],
    )
    return info


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
    """Identity of the bytes upstream is currently serving.

    `Last-Modified` is recorded but EXCLUDED from the hash, and `LAST UPDATED` is
    excluded from everything: both are stamps the publisher controls, not
    properties of the bytes. A republish of identical content must produce an
    identical fingerprint, or the "warn once per fingerprint" rule degenerates
    into "warn every run".

    Two uses:
      * unchanged fingerprint -> nothing new exists, exit 0 without downloading.
        That is not a failure.
      * a stale feed warns ONCE per fingerprint, not once per cron tick.
    """
    parts = "|".join(str(probe_info.get(k, "")) for k in
                     ("etag", "content_length", "probe_sha256", "first_row"))
    return hashlib.sha256(parts.encode("utf-8")).hexdigest()[:16]
