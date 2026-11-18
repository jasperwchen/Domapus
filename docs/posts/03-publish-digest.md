# Deciding whether to publish: a digest, not a count

Draft. Figures from `docs/CHANGES.md` (2026-09-06 entries) and `pipeline/release.py`.

## The setup

Domapus rebuilds its data once a month on GitHub Actions. Each run downloads Redfin's
1.34 GB file and Zillow's 124 MB file, computes statistics, and writes a snapshot, paint
tables and history files. Then it has to answer one question: did anything change? If yes,
commit and deploy. If no, stop.

## The count that never said no

The first answer was a count of changed cells. Every run, it reported 28,919 ZIPs changed.

The number was a constant. The comparison looped over a list of source keys that included
`period_end`, a key with no column in the published file. Reading it from the live snapshot
returned nothing for every ZIP, so every ZIP with Redfin data counted as changed by exactly
one field, forever:

    28,919 = 25,604 ZIPs with both feeds + 3,315 with Redfin only

The tell was in the published file the whole time. ZIPs changed and data points changed were
equal, which only happens if exactly one field differs per ZIP. A real month cannot produce
that.

Fixing the loop was not enough, because a count answers the wrong question. It conflates "did
the data move" with "did what we publish change". The verification run showed the
difference: 0 cells moved, yet the `zhvi_yoy` paint table and its class breaks had changed. A
single count cannot say both.

## The digest

Now the publish decision is a SHA-256 digest over everything a reader can see: the snapshot's
content columns and dictionaries, the class breaks, every paint table's own hash, every
history bucket and index, and the published statistical metadata. It leaves out build
timestamps, probe diagnostics and the age of the period, which change on every run without
changing anything a reader sees.

Rebuilding over unchanged input reproduces the digest byte for byte. So the decision no
longer depends on what happened to be lying around in a developer's `public/data/`.

The digest is both the release ID and the content digest in the manifest, and it is stamped
into the snapshot and the history index. The browser refuses to combine files from different
releases.

Two defaults follow from which mistake is cheaper:

- A missing or unreadable previous digest means changed. A redundant deploy costs a minute;
  a skipped one looks exactly like the deploy bug this repo already spent a phase fixing.
- An unchanged run still commits the new upstream fingerprints, so the next scheduled run
  does not repeat the same full download.

## Three bugs behind the first one

Running the new code found three more problems.

The change report first ran next to the gate, before the statistics stages. Seven published
columns are only filled later, so it compared this build's empty columns against last month's
real ones and called every ZIP changed: the same false positive in a new place. It now runs on
a finished build and refuses one where every reliability value is empty.

The paint tables were never published. The workflow copied four files into `public/data/`
and never touched `build/paint/`. Paint filenames carry a content hash, so a data change
renames them all, and the manifest would have named files that were not in the repo. The
build inlines those names into `index.html`, so this would have been a 404 on the critical
path and a grey map. It had not fired only because the broken count could never say
"unchanged". The workflow now replaces the paint directory wholesale, checks every declared
SHA-256 before committing, and stages deletions.

An unchanged upstream turned the workflow red. The probe stage correctly exits early when
nothing changed, but the next step read a manifest that only a full build writes. Every step
after it now checks whether the probe saw a change.

## The general point

A count is a summary of a diff, and a diff is only as good as the keys it walks. A digest over
the published bytes has no keys to get wrong: it changes exactly when what a reader would
download changes.
