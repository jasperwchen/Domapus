import pytest

from pipeline import gate, serialize
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
