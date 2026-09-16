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
- [ ] **Forecast metro growth path.** Tier 1 was never implemented and was collapsed into
      tier 0 on 2026-09-12. Writing the branch is open; restoring the label without it is not.

## Map

- [ ] **Reliability texture overlay for thin ZIPs.** `median_dom`, `months_of_supply`,
      `homes_sold` and `active_listings` are largely noise at ZIP level, and a 3-sale ZIP
      paints at full strength beside a 300-sale one. Plan: a diagonal hatch on tier-0 ZIPs at
      zoom >= 6, a runtime canvas pattern, one extra fill layer whose `fill-opacity` is a
      constant `case` on the existing `rel` feature-state. Texture, not opacity, because
      opacity is a lightness signal on a lightness ramp.

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
