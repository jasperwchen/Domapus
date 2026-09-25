# Domapus: open work

Open items only. Finished work goes to `docs/CHANGES.md`; standing rules live in `CLAUDE.md`.
Delete an item here when it is done and record it there.

## Current objective (2026-09-25, later)

Export panel requests and the full review are done and recorded in `docs/CHANGES.md`
("2026-09-25 (later)"). Nothing from 2026-09-23 on is committed yet; before a commit, ask about
temp files (the scratchpad is outside the repo).

What is left: 1c is deferred, 3i stays parked on it, 3l is ongoing, and section 2 needs you.

The list is split by what it needs from you:

1. **Decide.** There is more than one reasonable answer and it is your call.
2. **Do something only you can do.** Press a button on GitHub, log in to Google.
3. **Just needs doing.** The fix is known.

Size is a rough guess: small is under an hour, medium is a few hours, large is a day or more.

---

## 1. Decide

### 1c. Stripe the ZIPs whose numbers are mostly noise (deferred)

Four metrics (days on market, months of supply, homes sold, active listings) are unreliable
for ZIPs with a handful of sales, and the map colours them as confidently as busy ZIPs. The
proposal was diagonal stripes over low-sample ZIPs at zoom 6 and up. **Deferred 2026-09-24:**
the map already reads as busy, and stripes add texture on top. 3i waits on this.

---

## 2. Things only you can do

### 2a. Test the monthly data run by hand once

The monthly GitHub Action (`update_data.yml`) has a few steps that ordinary CI cannot
exercise, because they only run inside a real data run. Go to GitHub, Actions, "Update data",
"Run workflow" on `main` with default inputs. Since nothing new has been published upstream,
it should finish in seconds with "no change" and download nothing. That proves the early exit
works. Costs nothing and changes nothing.

The rest (checking that stale colour files get deleted and that an override reason reaches the
manifest word for word) can only be checked on the next real monthly run, 2026-10-18. That run
will also delete `zhvi_yoy-*.u8`, a real test of the stale-file path. I will check that run's
log if you ask.

### 2b. Tell Google where the sitemap is

A `robots.txt` file is how a site tells search engines where its sitemap (the list of pages)
lives. Google only reads it at the very root of the domain, `jasperwchen.github.io/robots.txt`.
Ours lives at `/Domapus/robots.txt`, so Google never sees it. Either submit the sitemap by hand
in Google Search Console (five minutes, needs your login), or add a root `robots.txt` to your
`jasperwchen.github.io` repo if you have one.

The two stale strings on our side (sitemap date, "real-time" description) are fixed.

---

## 3. Just needs doing

### 3i. Leftover code from the removed ZIP fading (small)

ZIPs used to fade when their data was unreliable. The fade was removed, but the code feeding
it still runs: every ZIP still gets a reliability value written onto the map, and a list of
"metrics exempt from fading" still exists on both the pipeline and the site. **Waits on 1c,
which is deferred.** If the stripes are built they reuse this; if not, delete it.

### 3l. Long history comments in code (ongoing)

Some files carry multi-paragraph "this used to do X" stories inline. The history belongs in
`docs/CHANGES.md`; the code should keep a one-line reason. Trim a file whenever it is touched
anyway, not as its own project.
