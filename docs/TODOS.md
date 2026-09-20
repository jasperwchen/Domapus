# Domapus: open work

Open items only. Finished work and reference facts live in `docs/CHANGES.md`; standing rules
in `CLAUDE.md`. Delete an item here when it is done and record it there.

`[ ]` todo · `[~]` in progress · `[!]` blocked

## Pipeline and data

- [ ] **Acceptance-test `update_data.yml` on a real dispatch.** These are step-ordering or
      `if:` guards CI cannot exercise, and the workflow has not been dispatched since they
      landed: the "Did upstream change?" short-circuit (dispatch with nothing new upstream),
      the `sha256sum -c` paint verification, and `git add -A public/data/paint` staging last
      month's hashed files as deletions. Also check the `env:`-quoted override reason
      (2026-09-16) reaches the manifest verbatim.
      Note before dispatching: the PUBLISHED manifest has `fingerprints: {}` and
      `upstream: {}`, because the 2026-07 release was built locally with `--skip-probe`
      and committed. `_live_fingerprints()` returns `{}`, which is falsy, so the
      short-circuit cannot fire and the next run always downloads. That is the safe
      failure direction — it does more work, not less — but it means the short-circuit
      is only testable on a SECOND dispatch, after a CI run has written real
      fingerprints. Order: dispatch once for the data, then dispatch again to see it
      exit 0 in ~0.2 s.
- [ ] **Forecast metro growth path.** Tier 1 was never implemented and was collapsed into
      tier 0 on 2026-09-12. Writing the branch is open; restoring the label without it is not.
- [ ] **`msp_yoy_se` has no producer.** It is column 47 of 50 and every ZIP ships null: no
      stage writes it, and the only other mentions are `map/types.ts` and an export test
      fixture. Either compute it in S5 (the standard error of a log ratio of two medians, so
      `sqrt(msp_rse_now^2 + msp_rse_year_ago^2)` needs last year's sample size) or drop the
      column. Dropping is a wire-format change: `SNAPSHOT_COLUMNS`, `FIELD_OF`, the 50-column
      assertions and both golden fixtures move together, and `diff` reports a format change
      for that release.
- [ ] **`zhvi_yoy` is painted but unreachable.** S6/S7 class and publish a 9th paint table on
      the `diverging` scheme, and `derive_ramp.mjs` generates `DIVERGING_COLORS`, but no
      metric in `metrics.ts` is marked `painted` for it, so the dropdown never offers it and
      nothing imports the diverging ramp. Worse, `classPaintExpression()` is the sequential
      ramp only, so selecting it today would paint signed data on a sequential scale, which
      the ramp script calls a correctness bug. Decide: wire it up with a per-metric ramp
      choice, or stop painting it and save the table.
- [ ] **Conditional permutation samples neighbours with replacement.** `local_moran()` draws
      `rng.integers(0, n - 1, size=(n, k))` and shifts past self, so one draw can pick the
      same neighbour twice; the standard conditional permutation draws k distinct ones. At
      n = 9,456 and k = 8 the bias is small, but it is a stated method that the code does not
      quite implement. Either draw without replacement or say so in the methodology page.

## Map

- [ ] **Reliability texture overlay for thin ZIPs.** `median_dom`, `months_of_supply`,
      `homes_sold` and `active_listings` are largely noise at ZIP level, and a 3-sale ZIP
      paints at full strength beside a 300-sale one. Plan: a diagonal hatch on tier-0 ZIPs at
      zoom >= 6, a runtime canvas pattern, one extra fill layer whose `fill-opacity` is a
      constant `case` on the existing `rel` feature-state. Texture, not opacity, because
      opacity is a lightness signal on a lightness ramp.
- [ ] **The tiny-ZIP dot layer is built, gated on, and never drawn.** `build_geometry.sh`
      writes `public/data/zcta-tiny-points.geojson` (991 features) and passes it to
      `verify_coverage.mjs --cover`, which counts those ids as covered so the per-zoom
      coverage gate passes. Nothing in `src/` ever loads the file, so the credit is for a
      rendering that does not exist: at z3 the tileset carries 33,573 of 33,780 polygons and
      the missing 207 reach the reader as nothing at all. Add the circle layer under
      `zips-fill`, coloured by the same constant match on the same feature id, or drop
      `--cover` and let the gate tell the truth about what z2/z3 lose.

## Performance

- [ ] **Re-baseline the bench at 14 classes.** `bench/results/uiux.json` was taken at
      `bca751e`, seven classes. Same pinned conditions (slow4g / 4x CPU / 1440x900 / 5 runs).
      Do this before any interaction fix, or the fix has nothing to be measured against.
- [ ] **Interaction jank: `pan.z4` and the two legend toggles.** Worst rows in the uiux run
      (pan.z4 60 dropped / 383 ms worst frame, toggle.autoScale 95 / 333 ms, toggle.outliers
      89 / 150 ms). Start here after the re-baseline.
- [ ] **Export memory on a real low-end phone.** Desktop peak is ~196 MB heap plus ~74 MB
      canvas at `EXPORT_SCALE = 3`. Whether a phone loses the WebGL context is unmeasured.
      Either test on a device or drop the scale to 2 (~13 MB GL backing instead of 29, 1.51x
      upscale, softer image).
- [ ] **Final full benchmark** after the last of the above lands, same pinned conditions as
      the 2026-08-29 baseline. Every phase: `node bench/run.mjs` before and after, into
      `bench/results/`.
