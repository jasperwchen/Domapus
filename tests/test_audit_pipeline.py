import hashlib

import pytest

from pipeline import gate, serialize, sources
from pipeline import __main__ as driver
from pipeline.contracts import PipelineError


def prices():
    return {"10001": {m: 100.0 for m in gate.GATED}}


@pytest.mark.parametrize("value", [None, 0, float("nan"), float("inf")])
def test_gate_refuses_unusable_price_comparisons(value):
    live = prices()
    live["10001"]["median_sale_price"] = value
    with pytest.raises(PipelineError, match="median_sale_price.*no usable"):
        gate.gate(prices(), live, {})
    report = gate.gate(prices(), live, {}, override=True, reason="verified rebuild")
    assert report["overridden"]


def test_gate_refuses_missing_metric_and_disjoint_zips():
    live = prices()
    del live["10001"]["median_sale_price"]
    with pytest.raises(PipelineError, match="no usable"):
        gate.gate(prices(), live, {})
    with pytest.raises(PipelineError, match="no usable"):
        gate.gate(prices(), {"10002": prices()["10001"]}, {})


@pytest.mark.parametrize("damage", ["missing", "length", "columns", "zero", "negative", "nan", "scale_missing"])
def test_invalid_snapshot_cannot_supply_a_gate_baseline(damage):
    payload = {"format": serialize.FORMAT, "version": serialize.VERSION,
               "f": ["msp"], "z": ["10001"], "d": [[100]], "scales": {"msp": 1}}
    if damage == "missing":
        payload["f"] = ["zhvi"]
    elif damage == "length":
        payload["d"] = [[]]
    elif damage == "columns":
        payload["d"] = []
    elif damage == "scale_missing":
        payload["scales"] = {}
    else:
        payload["scales"]["msp"] = {"zero": 0, "negative": -1, "nan": float("nan")}[damage]
    _, live = serialize.decode_live(payload, keys={"median_sale_price"})
    assert live == {}
    with pytest.raises(PipelineError, match="could not be decoded"):
        gate.gate(prices(), live, {}, live_expected=True)
    assert gate.gate(prices(), live, {}, live_expected=True, override=True,
                     reason="verified rebuild")["overridden"]


class Response:
    url = sources.ZHVI_URL

    def __init__(self, body, etag):
        self.content = body
        self.headers = {"ETag": etag, "Content-Length": str(len(body))}

    def raise_for_status(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def iter_content(self, chunk_size):
        yield self.content


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("change", ["etag", "body", "length", "missing_etag"])
def test_acquisition_rejects_changed_probed_identity(monkeypatch, tmp_path, stream, change):
    body = b"a" * 1200
    probe = {"etag": "multipart-2", "content_length": len(body),
             "probe_sha256": hashlib.sha256(body).hexdigest()}
    response = Response(b"b" * 1200 if change == "body" else body,
                        '"new-2"' if change == "etag" else '"multipart-2"')
    if change == "length":
        probe["content_length"] += 1
    if change == "missing_etag":
        response.headers.pop("ETag")
    monkeypatch.setattr(sources.requests, "get", lambda *a, **k: response)
    with pytest.raises(PipelineError, match="identity|probe|bytes"):
        if stream:
            sources.download(sources.ZHVI_URL, tmp_path / "feed.csv", "feed", expected_probe=probe)
        else:
            sources.fetch_bytes(sources.ZHVI_URL, "feed", expected_probe=probe)


@pytest.mark.parametrize("stream", [False, True])
def test_multipart_identity_is_not_treated_as_body_md5(monkeypatch, tmp_path, stream):
    body = b"a" * 1200
    probe = {"etag": "multipart-2", "content_length": len(body),
             "probe_sha256": hashlib.sha256(body).hexdigest()}
    monkeypatch.setattr(sources.requests, "get", lambda *a, **k: Response(body, '"multipart-2"'))
    if stream:
        sources.download(sources.ZHVI_URL, tmp_path / "feed.csv", "feed", expected_probe=probe)
        assert (tmp_path / "feed.csv").read_bytes() == body
    else:
        assert sources.fetch_bytes(sources.ZHVI_URL, "feed", expected_probe=probe) == body


@pytest.mark.parametrize("redfin,zhvi", [(None, None), ("local.csv", None), (None, "local.csv")])
def test_skip_probe_requires_both_local_inputs(monkeypatch, tmp_path, redfin, zhvi):
    monkeypatch.setattr(driver, "BUILD", tmp_path)
    with pytest.raises(PipelineError, match="skip-probe.*local"):
        driver.run(redfin, zhvi, skip_probe=True)
