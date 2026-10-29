# Domapus: open work

Open items only. Standing rules live in `AGENTS.md`. Delete finished items; record only
meaningful changes or decisions in `docs/CHANGES.md`, including their reasoning and evidence.
Routine test sessions do not need an entry.

The list is split by what it needs from you:

1. **Decide.** There is more than one reasonable answer and it is your call.
2. **Do something only you can do.** Press a button on GitHub, log in to Google.
3. **Just needs doing.** The fix is known.

Size is a rough guess: small is under an hour, medium is a few hours, large is a day or more.

---

## 1. Decide

### 1d. Visual cue for unreliable ZIP data (small–medium)

Reliability still lives in the paint byte and in popup/panel/legend numbers. The map fill
does not encode it (opacity fade was removed on purpose). Stripes were declined 2026-09-24
because the map already reads as busy. If sparse-ZIP overconfidence shows up in use, pick a
channel that is not lightness (texture, hatch, border) and gate it to closer zooms.

---

## 3. Just needs doing

### 3j. Sync dashboard state from URL on back/forward (small)

Invalid `?metric=` is rewritten to the painted fallback. Metric/zip/view are still read once
on mount; `useUrlState` only writes. Browser back/forward (or a shared link change without
remount) can leave the address bar and React state disagreeing. Subscribe to search params or
remount when they change. (Audit P2, 2026-10-29.)

### 3k. Tie ZHVI acquire to the S0 probe; harden `--skip-probe` (medium)

S0 fingerprints ZHVI; the full GET is not checked against that fingerprint in-run.
`--skip-probe` can publish empty fingerprints and skip Redfin size/MD5 checks. Fail or warn
loudly on those paths so a local/CI publish cannot wipe probe continuity. (Audit P2.)

### 3l. Fail or warn when DOM/MOS YoY feed scale is undetermined (small)

`changes._derive_scale` can return `scale: None` when no ZIP clears the discriminating floor;
the run can still pass if ratio-family reconcile succeeds. Treat an undetermined
difference-family scale as a loud warn or a hard fail. (Audit P2.)

---

## Noted (not open work — do not “improve” without a new decision)

From the 2026-10-29 audit. Left here so they are not forgotten or reopened casually.

- **Touch map preview.** Hover/popup is `mousemove`-only; tap selects with no preview.
  Acceptable for a choropleth; long-press or first-tap preview is optional polish only.
- **City / metro search on the main map.** ZIP-only today; export already has metro
  typeahead. Product feature, not a bug.
- **Cold-load performance.** Under pinned slow4g the cost is mostly network + tiles +
  snapshot, not choropleth apply (~20 ms metric switch). Measure later if needed: full-set
  feature-state writes, z11–z12 tile bytes, export/jsPDF split. Do not reintroduce
  snapshot-gated colour.
- **Committed PMTiles.** Stay in git unless you explicitly reopen that decision.
- **Opacity fade on the lightness ramp.** Do not restore.
- **Second class cutter beside `fitBreaks`.** Do not reintroduce.
- **County layer / Realtor.com.** Large product bets from old CHANGES notes, not bugfixes.
