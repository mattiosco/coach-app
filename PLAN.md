# Coach App — Plan

A phone-first PWA for managing game time, positions and rolling subs for a U11 girls 5-a-side team.
Fully offline, no backend, no accounts.

## 1. Core idea

The app is an **append-only event log plus a fold**. Every action during a game
(start clock, pause, sub, add a slot, loan a player out, end period) is an event.
All displayed state — who's on, minutes played, fairness deltas — is *derived* by
folding that log.

Why this matters more than it sounds:
- **Undo is free.** Pop the last event, re-fold. On a cold sideline you will tap the
  wrong name, and you need to fix it in one tap without corrupting the minutes.
- **Correction is free.** Edit or delete an event mid-game, minutes recompute.
- **Post-game summary is free.** The log already contains the whole match.
- **Crash recovery is free.** Persist the log after each event; reopening the app
  replays it and you're exactly where you were.

The clock is stored as `{ accumulatedMs, runningSince: timestamp | null }` and always
recomputed from `Date.now()`. Never accumulate in a `setInterval` — the phone will lock,
the tab will be backgrounded, and interval-based clocks drift badly.

## 2. Domain model

```
Player      { id, name, defaultGK: bool }
Season      { players[], matches[] }
Match       { id, date, opponent, config, availability, events[] }
MatchConfig { onFieldCount: 5, periods: 1 | 2, periodMinutes: 20, shiftMinutes: 5 }
Availability{ playerId -> present | absent | loaned }
Slot        { id, label }        // GK, DEF, LEFT, CENTRE, RIGHT (+ MID at 6-a-side)
```

Formation slots are just an ordered, editable list — that's what makes 4/5/6-a-side
a data change rather than a code change.

Event types:
`CLOCK_START`, `CLOCK_PAUSE`, `SUB{slotId, offPlayer, onPlayer}`, `SWAP{slotA, slotB}`,
`SLOT_ADD{label, playerId}`, `SLOT_REMOVE{slotId}`, `PERIOD_END`, `AVAILABILITY_CHANGE`.

Post-game only: `VOTES{first, second, third}` — a private coach 3-2-1. Never shown to
players or parents, and stored alongside the match. The season ledger totals votes across
matches so a best-and-fairest falls out for free at season's end.

Deliberately *not* in v1 but designed for: goals, scorers, per-position minutes. All three
are additional event types folded by the same reducer, so adding them in a future season
is additive, not a rewrite.

## 3. The rotation engine

Fair-share target for each outfield player:

```
target = (totalMatchMinutes * outfieldSlots) / availableOutfieldPlayers
```

With 10 girls, 1 fixed GK, 4 outfield slots, 40 minutes: **~17.8 min each**.
Every player shows a `+/-` delta against her target. That single number is what makes
the app worth having — it answers "who's been robbed?" instantly.

At each shift buzzer the app **proposes** a sub set:
- Field players sorted by minutes-above-target → candidates to come off.
- Bench players sorted by minutes-below-target → candidates to come on.
- Positional continuity: incoming player takes the outgoing player's slot unless
  overridden.
- Sanity guards: don't sub someone who just came on; keep the GK untouched.

Proposals are always shown for review and confirmed with one tap. **Nothing auto-applies.**
The coach's judgement wins; the app just does the arithmetic he can't do while watching a game.

## 4. Screens

1. **Squad** — add/edit players, mark today's absentees, mark the default GK.
2. **Match setup** — opponent, a-side count, 1×40 or 2×20, shift length, GK for the day,
   starting five (with a "suggest" button biased by last game's shortfall).
3. **Game** (the only screen that matters):
   - Big clock, period, and a shift countdown ring.
   - Pitch view: one large card per slot showing position label + name + minutes.
   - Bench list sorted most-rested-first, each with a minutes badge and `+/-` delta.
   - Tap a bench player then a field player to swap (or tap a slot, then a bench player).
   - Persistent **Undo**, big **Start/Pause**, and a **SUB NOW** banner + vibration at
     each shift boundary.
   - `+ / −` stepper on the on-field count for mid-game format changes.
4. **Summary** — minutes per player and fairness table, then a private 3-2-1 vote entry
   (three taps, skippable). Coach's eyes only.

Design constraints: sunlight-readable high contrast, thumb-sized targets, one-handed
reach, portrait lock, Screen Wake Lock API so the phone doesn't sleep mid-game.

## 5. The awkward real-world cases (designed in, not bolted on)

| Situation | Handling |
|---|---|
| Half time vs none | `periods: 1 or 2`. Half time = auto-pause + "swap ends" flip of the pitch view. Purely cosmetic beyond the pause. |
| 4 / 6 / 7-a-side | On-field count stepper. Increasing prompts who comes on and what the new slot is called; decreasing prompts who comes off. Recalculates fair share immediately. |
| Lending a player to the other team | Mark her `loaned`. She leaves the rotation and her clock stops; a "return" button puts her back on the bench. Her target is prorated to the minutes she was actually available. |
| GK on all game | GK slot is pinned and excluded from rotation suggestions. Her minutes are tracked but kept out of the fairness maths (with a toggle if you ever rotate the gloves). |
| Late arrival / early leave | Availability change is an event, so her target is based on minutes available, not the full game. |
| Two games a week | A season ledger carries each player's cumulative `+/-` forward, so game 2's suggested starting five favours whoever was short in game 1. |

## 6. Tech

- **Vite + React + TypeScript**, `vite-plugin-pwa` (Workbox) for the service worker.
- No state library — a `useReducer` folding the event log is exactly the right shape.
- **IndexedDB** (`idb-keyval`) for persistence; small enough to be instant, safer than
  localStorage against eviction.
- **No backend, no network calls at all.** The app works identically in a paddock with
  no signal. It must be loaded once over HTTPS to install; after that it's fully offline.
- Deploy as a static site (GitHub Pages or Netlify), then "Add to Home Screen" on the phone.
- **Vitest** unit tests on the engine — the fold, the minutes maths, the sub suggester.
  That's where bugs actually cost you; the UI can be checked by eye.

## 7. Build order

| Phase | Deliverable |
|---|---|
| 0 | Scaffold + PWA + deploy, installed on your phone. Do this first to de-risk install/offline early. |
| 1 | Squad management and match setup, persisted. |
| 2 | Clock + event log + derived minutes + manual subs + undo. Usable at a real game. |
| 3 | Fairness deltas, shift buzzer, sub suggestions. |
| 4 | Flexible formats: a-side stepper, loans, periods, late arrivals. |
| 5 | Post-game summary, season ledger, JSON export/import backup. |
| 6 | Polish: wake lock, haptics, sunlight theme, install prompt. |

End of phase 2 is the first genuinely useful version — worth taking to a game before
building the rest.

## 8. Decisions

Settled at kickoff:
- **Time only** during the game, plus a private post-game 3-2-1 vote. Goals and scorers
  deferred to a future season.
- **Total minutes only** — no per-position breakdown for now. The event log records slots
  anyway, so it can be surfaced later without a migration.
- **No parent sharing** for now. Summary stays on the phone.
- **GitHub Pages** hosting, deployed from a push via GitHub Actions.
