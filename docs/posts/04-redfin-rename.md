# Redfin renamed a column, and our run died on a value it throws away

Draft. Figures from `docs/CHANGES.md` (2026-09-19 entry).

## What happened

On 2026-09-18 the monthly data run failed after downloading Redfin's whole 1.33 GB file:

    redfin_raw: 1 expected column(s) missing (schema drift): ['MEDIAN DAYS ON MARKET YOY (%)']

Redfin's new release had renamed it to `MEDIAN DAYS ON MARKET YOY (DAYS)`. The ironic part:
Domapus never publishes that column. The pipeline recomputes every year-over-year change from
the published levels, and overwrites the feed's own value before validation. The run died on
a number it was going to discard.

## It was not only renamed

Before aliasing the header, we compared the new column to the old one, using a ranged
request for the first 6 MB of the live file (the newest period) against last month's panel:

| | Old, `(%)` | New, `(DAYS)` |
|---|---|---|
| Median absolute value | 1,301.22 | 11.00 |
| Range | -654,499 to 508,029 | -3,876 to 7,074 |
| Whole numbers | no | yes, all |

So the column was rescaled too. The old one was the change in days times 100, under a header
that said percent: 1,301.22 / 100 = 13.01 days, against 11 days now. It was never a percent
change; a percent change cannot reach -3,876%.

A 4 MB window from deep in the file, covering mid-2023, showed the same whole-day scale.
Redfin had rewritten the column's entire history, not just the new rows. `MONTHS OF SUPPLY
YOY` was untouched: still x100 under "(%)".

## The divisor that could not be seen

The code already had a declared fix for the x100: a set named `DIVIDE_BY_100`, applied when
cleaning the feed. But the year-over-year recompute overwrote that value on the very next
line. The divisor was dead code in the production path.

Had we simply aliased the new header and kept the divisor, a -6 day change would have become
-0.06, with no observable effect anywhere. No test, contract or manifest field could see it.
The test that "proved" the /100 ran against a frozen fixture, so it would have kept passing
while asserting something upstream no longer did.

## What changed

**A column is required only as far as something published depends on it.** Each field now
lists its accepted header spellings, newest first, and the pipeline binds to whichever the
file has. The 14 level columns are what the site publishes, so a missing one stops the run,
and the error names the closest headers actually in the file instead of printing 50 columns
and leaving you to spot the rename. A missing year-over-year column becomes an all-null
column and a logged gap. Keeping the column list fixed matters: a column that silently
vanishes crashes two stages later, where nothing remembers why.

**The header is checked before the download.** The first stage already fetched 1 MB of the
file to fingerprint it. Binding the header there takes 0.1 ms and reaches the same verdict
1.33 GB and 25 seconds earlier. Writing it found one more bug: Redfin quotes every header
field, and splitting the line on commas kept the quotes, so the probe parses the line as CSV.

**The scale is measured every run, never declared.** For the two difference-style columns,
the pipeline compares the feed's published value against its own 12-month difference of the
levels, for each candidate scale (x1 and x100), and requires a clear winner: over 50% agreement
and ten times the runner-up. On the real panel, x100 agreed for 100.0% of 12,985 ZIPs that
moved enough to tell. Dividing the column by 100 to simulate the new release flips the answer
to x1, and a nonsense x7 column raises rather than snapping to the nearest candidate. The
winner is recorded in the manifest, so a units change is visible on the release it happens.

The reconciliation tolerances were measured too. The only gap between our recompute and
Redfin's value is the rounding of the published level: exactly 0.0 or 0.5 days for days on
market, at most 0.0993 for months of supply. The tolerance is three times those maxima, and 0
of about 23,000 ZIPs exceed it.

## The general point

The run that died was the system working, a little too strictly. The dangerous version was
the one that would have passed: a silent units error in a column with a dead correction in
front of it. Declared constants about someone else's data go stale without telling you.
Measure them against something you computed yourself, every time.
