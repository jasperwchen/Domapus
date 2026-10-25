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

### 1c. Stripe the ZIPs whose numbers are mostly noise (deferred)

Four metrics (days on market, months of supply, homes sold, active listings) are unreliable
for ZIPs with a handful of sales, and the map colours them as confidently as busy ZIPs. The
proposal was diagonal stripes over low-sample ZIPs at zoom 6 and up. **Deferred 2026-09-24:**
the map already reads as busy, and stripes add texture on top. 3i waits on this.

---

## 3. Just needs doing

### 3i. Leftover code from the removed ZIP fading (small)

ZIPs used to fade when their data was unreliable. The fade was removed, but the code feeding
it still runs: every ZIP still gets a reliability value written onto the map, and a list of
"metrics exempt from fading" still exists on both the pipeline and the site. **Waits on 1c,
which is deferred.** If the stripes are built they reuse this; if not, delete it.
