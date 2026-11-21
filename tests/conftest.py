"""Refuse to run the pipeline tests on a Python other than the one CI and the data run use.

CI and update_data.yml read `.python-version`. A machine whose `python` is 3.13 ran all 150
tests green without noticing, which proves nothing about 3.14. Use `py -3.14 -m pytest` on
Windows if `python` resolves to something else.
"""

import sys
from pathlib import Path

import pytest

PINNED = Path(__file__).resolve().parent.parent / ".python-version"


def pytest_configure(config):
    want = tuple(int(p) for p in PINNED.read_text(encoding="utf-8").strip().split(".")[:2])
    have = sys.version_info[:2]
    if have != want:
        raise pytest.UsageError(
            f"pipeline tests need Python {'.'.join(map(str, want))} (.python-version), "
            f"this is {'.'.join(map(str, have))}. On Windows: py -{'.'.join(map(str, want))} -m pytest"
        )
