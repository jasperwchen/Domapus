"""Domapus monthly data pipeline.

Replaces `scripts/update_market_data.py`. Three properties that script did not have,
and every one of them was a shipped bug (spec FINAL-SPEC-08-2026 sections 1.1, 1.5):

1. The declared grain is ASSERTED before any reduction. The old code used
   `drop_duplicates('zip_code')` as a filter on a key nobody had proved was a key,
   so pandas' unstable quicksort picked an arbitrary property type per ZIP and
   re-randomized it every run.
2. Nothing here writes `public/data/`. Every stage writes `build/` plus a report;
   publication is a separate, atomic step (see spec section 8.3).
3. The full 173-period panel is kept, not thrown away. The old code discarded 172
   of 173 periods, which made every statistic in Phase 5 and every history in
   Phase 7 unbuildable.
"""

from .contracts import PipelineError

__all__ = ["PipelineError"]
