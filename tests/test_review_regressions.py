import json
from unittest.mock import Mock

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from pipeline import __main__ as driver, forecast, panel, release, zhvi
from pipeline.contracts import PipelineError


@pytest.mark.parametrize("local", ["redfin", "zhvi"])
def test_local_input_survives_matching_probes(tmp_path, monkeypatch, local):
    monkeypatch.setattr(driver, "BUILD", tmp_path / "build")
    monkeypatch.setattr(driver.sources, "probe", lambda *a: {})
    monkeypatch.setattr(driver.sources, "fingerprint", lambda *a: "same")
    monkeypatch.setattr(driver, "_live_fingerprints", lambda: {"redfin": "same", "zhvi": "same"})
    monkeypatch.setattr(driver.sources, "probe_header", lambda *a: [])
    monkeypatch.setattr(driver.units, "resolve", lambda *a: Mock(aliased={}, missing_yoy=[]))
    monkeypatch.setattr(driver.sources, "download", lambda url, dest, *a, **kw: dest.write_bytes(b"csv"))
    monkeypatch.setattr(driver.sources, "fetch_bytes", lambda *a: b"csv")
    ingest = Mock(side_effect=PipelineError("reached ingestion"))
    monkeypatch.setattr(driver.redfin, "ingest", ingest)
    csv = tmp_path / "local.csv"
    csv.write_bytes(b"csv")
    with pytest.raises(PipelineError, match="reached ingestion"):
        driver.run(csv if local == "redfin" else None, csv if local == "zhvi" else None, False)
    ingest.assert_called_once()


def test_missing_month_is_rejected_before_positional_changes(tmp_path):
    months = pd.date_range("2025-07-31", "2026-09-30", freq="ME").strftime("%Y-%m-%d").tolist()
    months.remove("2025-10-31")
    frame = pd.DataFrame([np.arange(len(months)) + 100], columns=months, index=["02134"])
    with pytest.raises(PipelineError, match="consecutive month ends"):
        zhvi.process(frame, months)
    path = tmp_path / "panel.parquet"
    pq.write_table(pa.table({"zip": ["02134"] * len(months), "period_end": months}), path)
    with pytest.raises(PipelineError, match="consecutive month ends"):
        panel.verify(path, len(months))


def test_release_includes_history_metadata_and_produces_repeatable_archives(tmp_path):
    root = tmp_path
    (root / "history").mkdir()
    (root / "zip-data.json").write_text(json.dumps({"version": 1, "d": [[1]], "built_utc": "first"}))
    (root / "history/index.json").write_text(json.dumps({"q": {"12": [1, 2]}}))
    bucket = root / "history/0213.json"
    bucket.write_text('{"zips":{"02134":{"msp":[1,2]}}}')
    manifest = {"assets": {"paint": {}}, "forecast": {"coverage": .8},
                "validation": {"period_age_days": {"redfin": 10}}}
    first = release.finalize(root, manifest)
    archives = manifest["assets"]["archives"].copy()
    snapshot = json.loads((root / "zip-data.json").read_text())
    snapshot["built_utc"] = "second"
    manifest["validation"]["period_age_days"]["redfin"] = 11
    (root / "zip-data.json").write_text(json.dumps(snapshot))
    assert release.finalize(root, manifest) == first
    assert manifest["assets"]["archives"] == archives
    bucket.write_text('{"zips":{"02134":{"msp":[9,2]}}}')
    history_fix = release.finalize(root, manifest)
    assert history_fix != first
    manifest["forecast"]["coverage"] = .9
    forecast_fix = release.finalize(root, manifest)
    assert forecast_fix != history_fix
    manifest["assets"]["paint"] = {"zhvi": {"sha256": "changed"}}
    assert release.finalize(root, manifest) != forecast_fix


def test_backtest_purges_future_calibration_and_uses_origin_counts(monkeypatch):
    rng = np.random.default_rng(3)
    levels = 12 + np.cumsum(rng.normal(.002, .01, (180, 3)), axis=0)
    levels[:90, 2] = np.nan
    original = forecast.fit
    seen = []

    def checked_fit(data, counts=None):
        assert counts is not None
        np.testing.assert_array_equal(counts, np.isfinite(data).sum(axis=0))
        seen.append(len(data))
        return original(data, counts)

    monkeypatch.setattr(forecast, "fit", checked_fit)
    report = forecast.backtest(levels, np.ones(3, dtype=bool))
    origins = report["origins"]
    assert origins["last_calibration"] + max(forecast.HORIZONS) <= origins["first_evaluation"]
    assert origins["purged"] > 0
    assert min(seen) < 180
