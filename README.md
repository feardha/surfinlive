# SurfinLive

A browser-based **tournament generator** prototype — a clone of the *liveshow* idea:
seed a list of participant names, and the engine builds a single-elimination-style
bracket where **every round is split into shows of 4–5 contestants, the best 2 per show
advance, and the rest are eliminated**, narrowing down to one champion.

This prototype runs **entirely in the browser with no database**. A MySQL backend can be
added later (see *Adding MySQL* below) without changing the bracket logic.

---

## Run it

No build step, no install. Just open the page:

```bash
# option A — open directly
open dashboard.html      # macOS
xdg-open dashboard.html  # Linux
start dashboard.html     # Windows

# option B — serve it (recommended; some browsers tighten file://)
python3 -m http.server 8000
# then visit http://localhost:8000
```

Then:

1. Type one participant name per line (2 minimum). Sample chips (8/12/16/32) prefill the box.
2. Click **Generate bracket**.
3. Either:
   - **Simulate (random)** — assigns random scores and plays the whole bracket out, or
   - **Manual** — click exactly 2 contestants per show to advance, hit *Advance this round →*,
     and repeat until the Final crowns a champion. Click a picked contestant again to undo.
4. **Reset results** returns the same bracket to fresh (manual) so you can re-play it.

### Rounds & ladder

The **Final** is always the last round and always holds **exactly 4 contestants** (it is
itself a show of 4, fed by 2 semifinals each advancing 2). The top 2 of that Final show are
crowned **champion** and **runner-up** — they do not advance further.

**Re-randomized draws.** Every time a round advances (e.g. Octofinal → Quarterfinal), the
survivors are **re-shuffled** before being seeded into the next round. So each new round
always gets a freshly generated order — both *which* show a contestant lands in and their
*position within it* change between rounds. This applies in both Manual and Simulate modes.
Round 1 keeps the one initial shuffle from `generateTournament`.

**Show status lifecycle.** Every show carries a `status`:
- `open` — created but not yet the active round (its slots are still `TBD` in later rounds, or
  it is an as-yet-unreached show). On a freshly generated bracket, *every* show starts `open`
  except the distributed first round.
- `active` — the show belongs to the current round that has real contestants distributed to it
  (the round the user is scoring / the round just advanced into).
- `closed` — the round this show belongs to has been scored (advanced). Once closed it stays
  closed unless the bracket is reset or re-opened with `clearFromRound`.

Exactly one `active` show is also flagged **`live`** — the first show of the currently active
round. This is the show the **Live View** page streams (names + live-ticking dummy scores).
When a round is advanced, its shows become `closed` and the *next* round's first show becomes
`live`. Generated brackets mark the first distributed show as `live` immediately, so Live View
always has a show to show. If you open Live View without a bracket in the Dashboard (e.g. a
fresh tab), it falls back to simulating a random show.

The bracket follows the canonical show ladder:

`Preliminary → Octofinal → Quarterfinal → Semifinal → Final`

Smaller fields use a shorter suffix of that ladder (e.g. 8 surfers = Semifinal → Final;
32 surfers = Octofinal → Quarterfinal → Semifinal → Final). A full 5-round ladder appears
around **64 participants** (16 shows in the Preliminary). Fields above 64 add `Qualifying N`
rounds in front of the ladder.

### Handling odd / awkward counts

Not every participant count divides cleanly into 4–5 shows with exactly 2 advancing into a
4-person Final (e.g. 5, 6, 11). To keep the rule exact for **any** input, small fields are
padded with **BYE** slots in the first round. A BYE occupies a show slot but is
auto-eliminated in round 1 and can never win — so every show stays exactly 4 or 5 and the
Final always has exactly 4. The number of BYEs is shown when a bracket is generated.

---

## Project layout

```
SurfinLive/
├── index.html        # MAIN page — Live View markup + script includes
├── dashboard.html    # Dashboard (tournament generator) markup + script includes
├── styles.css        # dark "surf" theme
├── tournament.js    # PURE bracket engine (no DOM, no deps). Tested in Node.
├── app.js            # UI controller — wires the engine to the Dashboard DOM
├── live.js           # Live View controller — shows the show flagged "Live"
├── index.html        # Live View page (the main page; links to the Dashboard)
├── store.js          # Durable cache: every generated tournament in localStorage
├── test.js           # Node test: random simulation across field sizes 2..64
├── test_manual.js    # Node test: manual pick-through + reset
├── test_live.js      # Node test: Live View renders the Live show + ticks
├── test_lifecycle.js # Node test: show status lifecycle + Live-show selection
└── test_dom.js       # jsdom test: real dashboard.html + scripts end-to-end
```

`tournament.js` is a standalone module — it works in the browser (`window.SurfinLive`)
and in Node (`module.exports`), so the bracket math can be unit-tested without a browser.

### Public engine API (`window.SurfinLive`)

| function | purpose |
|---|---|
| `generateTournament(names)` | build a bracket skeleton from a name array |
| `simulateTournament(t[, rng])` | play it out with random (or provided) scores |
| `scoreRound(t, idx[, rng])` | apply the user's picks for one round and promote winners (re-shuffled) |
| `clearFromRound(t, idx)` | wipe a round and everything below it (re-pick) |
| `resetResults(t)` | back to freshly-generated (manual) state |
| `partition4or5`, `padToCleanSize`, `cleanReaches2` | internal helpers (shows of 4–5 math) |

---

## Tests

```bash
node test.js         # random bracket correctness (shows of 4-5, top-2, no dupes, 2..64)
node test_manual.js  # manual play-through + clearFromRound reset
npm install jsdom    # one-time, for the DOM test
node test_dom.js     # drives the real index.html + scripts in a headless DOM
```

All three pass. `test_dom.js` requires `jsdom` (dev-only; it is **not** needed to run the app).

---

## Adding MySQL later

The engine is intentionally free of I/O, so persistence is an additive layer:

1. **Store, don't recompute.** Generate the bracket with `generateTournament`, then persist:
   - `tournaments(id, name, created_at, status)`
   - `participants(id, tournament_id, name, seed)`
   - `rounds(id, tournament_id, round_index, round_name, is_final)`
   - `shows(id, round_id, show_label, show_index)`
   - `show_entries(id, show_id, participant_id, score, status, picked)` — `status` ∈
     `pending|advanced|eliminated|champion|runnerup`, `BYE` rows get `is_bye=1`.
2. **Load back into the engine shape** (`tournament.rounds[].shows[].contestants`) to reuse
   the exact same `render` / `scoreRound` / `simulateTournament` code on the client.
3. **Manual scoring** becomes `UPDATE show_entries SET picked=1` per pick, then call
   `scoreRound` server-side (or replicate its promotion logic in SQL) to fill `status` and
   promote winners into the next round's `show_entries`.
4. **Simulate** persists the random `score` values so results are reproducible/auditable.
5. Optionally move `shuffle`/`partition4or5` logic to a stored procedure or keep it client-side
   and only persist the resulting seed list — the bracket is deterministic once seeded.

The UI (`app.js`) already treats the tournament as a plain object, so swapping the in-memory
object for one hydrated from MySQL is a localized change (replace `generate`/`scoreRound`/
`simulate` calls with `fetch`/`POST` to your API).

---

## Durable tournament cache

The Dashboard and the Live View are separate pages. To make sure **every tournament
stays accessible after it is generated** — across navigation, page reloads, and new tabs —
a shared `store.js` persists **all** generated brackets in `localStorage`:

- `surfinlive.tournaments` — a map of `{ id: { id, createdAt, title, tournament } }`.
  Every `Generate bracket` call appends a new entry; advancing / simulating / resetting
  a bracket updates its stored copy in place.
- `surfinlive.current` — the id of the most-recently-touched tournament.

On the **Dashboard**, the current tournament is restored automatically on page load, so
pressing *Dashboard* (or reopening the tab) never loses the bracket you were working on.
On the **Live View**, a **Tournament** dropdown lists every cached tournament (newest
first, labelled by size + time); the selected one's `live` show is streamed. Picking a
different tournament in the dropdown switches the Live View to that bracket's live show.
If storage is unavailable (e.g. `file://` in a strict browser, private mode), the store
falls back to an in-memory object for the lifetime of the tab and the Live View shows a
random show.

> Note: this is still a prototype — the cache is per-browser and not encrypted. Clearing
> site data wipes it. There is no per-tournament delete UI yet.

- Names must be unique-ish for nice display; duplicates are allowed but will look identical in the UI.
- Persistence is a per-browser `localStorage` cache (see *Durable tournament cache*); it is
  not encrypted and clearing site data wipes it. There is no server/MySQL backing yet.
- BYEs only ever appear in round 1.
