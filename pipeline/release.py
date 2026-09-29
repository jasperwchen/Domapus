"""Deterministic release identity and immutable download archives."""

import gzip
import hashlib
import io
import json
import tarfile
from pathlib import Path


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def finalize(root: Path, manifest: dict) -> str:
    """Stamp related files only after hashing their timestamp-independent content."""
    from .serialize import payload_digest

    snapshot_path = root / "zip-data.json"
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    history_dir = root / "history"
    index_path = history_dir / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    index.pop("release_id", None)
    history_hashes = {p.name: sha256(p) for p in sorted(history_dir.glob("*.json"))
                      if p.name != "index.json"}
    history_hashes["index.json"] = hashlib.sha256(canonical(index)).hexdigest()
    # Run diagnostics and comparisons to the previous release are not public data identity.
    metadata = {k: manifest[k] for k in (
        "redfin", "zhvi", "panel", "coverage", "orphans", "validation", "changes",
        "noise", "forecast", "spatial", "classes", "classing", "history",
    ) if k in manifest}
    if "validation" in metadata:
        metadata["validation"] = {k: v for k, v in metadata["validation"].items()
                                  if k != "period_age_days"}
    identity = {"snapshot": payload_digest(snapshot), "history": history_hashes,
                "paint": manifest["assets"]["paint"], "metadata": metadata}
    digest = hashlib.sha256(canonical(identity)).hexdigest()
    snapshot["release_id"] = index["release_id"] = digest
    snapshot_path.write_bytes(canonical(snapshot))
    if "snapshot" in manifest:
        manifest["snapshot"]["bytes"] = snapshot_path.stat().st_size
    index_path.write_bytes(canonical(index))
    prefix = f"releases/{digest}"
    manifest["release_id"] = digest
    manifest["assets"]["snapshot"] = f"{prefix}/zip-data.json"
    manifest["assets"]["history"] = f"{prefix}/history/<zip4>.json"

    archives = {}
    for kind in ("snapshot", "history"):
        name = f"{kind}-{digest}.{'json.gz' if kind == 'snapshot' else 'tar.gz'}"
        path = root / name
        with path.open("wb") as target, gzip.GzipFile(fileobj=target, mode="wb", mtime=0,
                                                     filename="") as compressed:
            if kind == "snapshot":
                # Build time is diagnostic; identical releases must have identical archives.
                archived = {k: v for k, v in snapshot.items() if k != "built_utc"}
                compressed.write(canonical(archived))
            else:
                with tarfile.open(fileobj=compressed, mode="w|") as archive:
                    for file in sorted(history_dir.glob("*.json")):
                        data = file.read_bytes()
                        info = tarfile.TarInfo(file.name)
                        info.size = len(data)
                        info.mode = 0o644
                        archive.addfile(info, io.BytesIO(data))
        archives[kind] = {"file": name, "sha256": sha256(path)}
    manifest["assets"]["archives"] = archives
    return digest
