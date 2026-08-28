import { describe, expect, it } from 'vitest'
import {
  MINUTE,
  currentClock,
  fairShares,
  foldMatch,
  minutesPlayedMs,
  undoLast,
  type MatchInit,
} from './engine'
import type { MatchEvent } from './events'
import { DEFAULT_SLOTS, type Player } from './types'

const roster: Player[] = [
  'Ava',
  'Bea',
  'Cleo',
  'Dot',
  'Eve',
  'Fay',
  'Gia',
  'Hana',
  'Ivy',
  'Jo',
].map((name) => ({ id: name.toLowerCase(), name }))

const init: MatchInit = {
  slots: DEFAULT_SLOTS,
  availability: {},
}

const config = { totalMinutes: 20, periods: 1, shiftMinutes: 5 }

/** Kick off with the first five, keeper first. */
function lineup(clock = 0): MatchEvent {
  return {
    t: 'LINEUP',
    at: 1000,
    clock,
    slots: DEFAULT_SLOTS,
    assignments: { gk: 'ava', def: 'bea', left: 'cleo', centre: 'dot', right: 'eve' },
  }
}

const mins = (ms: number) => Math.round((ms / MINUTE) * 100) / 100

describe('stint accounting', () => {
  it('credits time between coming on and going off', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 1000, clock: 0 },
      { t: 'SUB', at: 0, clock: 5 * MINUTE, slotId: 'def', off: 'bea', on: 'fay' },
      { t: 'MATCH_END', at: 0, clock: 20 * MINUTE },
    ]
    const state = foldMatch(roster, init, events)

    expect(mins(minutesPlayedMs(state, 'bea', 20 * MINUTE))).toBe(5)
    expect(mins(minutesPlayedMs(state, 'fay', 20 * MINUTE))).toBe(15)
    // The keeper is on the whole way.
    expect(mins(minutesPlayedMs(state, 'ava', 20 * MINUTE))).toBe(20)
    // Never came on.
    expect(mins(minutesPlayedMs(state, 'jo', 20 * MINUTE))).toBe(0)
  })

  it('does not accrue time while the clock is paused', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'CLOCK_PAUSE', at: 60_000, clock: 5 * MINUTE },
    ]
    const state = foldMatch(roster, init, events)

    // Ten minutes of wall clock later, the game clock has not moved.
    expect(currentClock(state, 60_000 + 10 * MINUTE)).toBe(5 * MINUTE)
    expect(mins(minutesPlayedMs(state, 'bea', currentClock(state, Date.now())))).toBe(5)
  })

  it('keeps both stints when a player comes on, off, then on again', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'SUB', at: 0, clock: 4 * MINUTE, slotId: 'def', off: 'bea', on: 'fay' },
      { t: 'SUB', at: 0, clock: 10 * MINUTE, slotId: 'def', off: 'fay', on: 'bea' },
      { t: 'MATCH_END', at: 0, clock: 20 * MINUTE },
    ]
    const state = foldMatch(roster, init, events)
    expect(mins(minutesPlayedMs(state, 'bea', 20 * MINUTE))).toBe(14)
    expect(mins(minutesPlayedMs(state, 'fay', 20 * MINUTE))).toBe(6)
  })

  it('treats a positional swap as continuous time for both players', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'SWAP', at: 0, clock: 8 * MINUTE, slotA: 'left', slotB: 'right' },
      { t: 'MATCH_END', at: 0, clock: 20 * MINUTE },
    ]
    const state = foldMatch(roster, init, events)
    expect(mins(minutesPlayedMs(state, 'cleo', 20 * MINUTE))).toBe(20)
    expect(mins(minutesPlayedMs(state, 'eve', 20 * MINUTE))).toBe(20)
    expect(state.onField.left).toBe('eve')
    expect(state.onField.right).toBe('cleo')
  })
})

describe('fair shares', () => {
  it('splits outfield minutes evenly and excludes the keeper', () => {
    const state = foldMatch(roster, init, [lineup(), { t: 'CLOCK_START', at: 0, clock: 0 }])
    const shares = fairShares(roster, state, config, 0)
    const byId = new Map(shares.map((s) => [s.playerId, s]))

    // 20 minutes x 4 outfield slots = 80 player-minutes, over 9 outfield players.
    expect(mins(byId.get('bea')!.targetMs)).toBeCloseTo(8.89, 1)
    // The keeper is out of the rotation entirely.
    expect(byId.get('ava')!.targetMs).toBe(0)

    const outfieldTotal = shares
      .filter((s) => s.playerId !== 'ava')
      .reduce((sum, s) => sum + s.targetMs, 0)
    expect(mins(outfieldTotal)).toBeCloseTo(80, 1)
  })

  it('shows who is owed time as a negative delta', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'SUB', at: 0, clock: 10 * MINUTE, slotId: 'def', off: 'bea', on: 'jo' },
    ]
    const state = foldMatch(roster, init, events)
    const shares = fairShares(roster, state, config, 10 * MINUTE)
    const byId = new Map(shares.map((s) => [s.playerId, s]))

    // Bea has had 10 of a fair 8.89, so she is ahead.
    expect(byId.get('bea')!.deltaMs).toBeGreaterThan(0)
    // Jo has only just come on, so she is still owed.
    expect(byId.get('jo')!.deltaMs).toBeLessThan(0)
  })

  it('prorates the target of a player lent to the other team', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'AVAILABILITY', at: 0, clock: 10 * MINUTE, playerId: 'jo', status: 'loaned' },
    ]
    const state = foldMatch(roster, init, events)
    const shares = fairShares(roster, state, config, 10 * MINUTE)
    const byId = new Map(shares.map((s) => [s.playerId, s]))

    // Jo was available for half the match, so she is owed about half a normal share
    // rather than looking robbed of a full one.
    const jo = byId.get('jo')!
    const staying = byId.get('gia')!
    expect(jo.targetMs).toBeGreaterThan(0)
    expect(jo.targetMs).toBeLessThan(staying.targetMs)
    expect(jo.targetMs / staying.targetMs).toBeCloseTo(0.5, 1)
  })

  it('pulls a loaned player off the park automatically', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'AVAILABILITY', at: 0, clock: 6 * MINUTE, playerId: 'cleo', status: 'loaned' },
    ]
    const state = foldMatch(roster, init, events)
    expect(state.onField.left).toBeNull()
    // Her clock stops the moment she leaves.
    expect(mins(minutesPlayedMs(state, 'cleo', 15 * MINUTE))).toBe(6)
  })

  it('raises everyone else’s target when the team goes to six a side', () => {
    const base = foldMatch(roster, init, [lineup(), { t: 'CLOCK_START', at: 0, clock: 0 }])
    const before = fairShares(roster, base, config, 0).find((s) => s.playerId === 'bea')!

    const state = foldMatch(roster, init, [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      {
        t: 'SLOT_ADD',
        at: 0,
        clock: 0,
        slot: { id: 'mid', label: 'Mid', isGK: false },
        playerId: 'fay',
      },
    ])
    const after = fairShares(roster, state, config, 0).find((s) => s.playerId === 'bea')!

    // Five outfield slots over nine players instead of four.
    expect(after.targetMs).toBeGreaterThan(before.targetMs)
    expect(mins(after.targetMs)).toBeCloseTo(11.11, 1)
  })
})

describe('undo', () => {
  it('removes the last event and its effect', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'SUB', at: 0, clock: 5 * MINUTE, slotId: 'def', off: 'bea', on: 'fay' },
    ]
    const { events: after, state } = undoLast(roster, init, events, Date.now())

    expect(after).toHaveLength(2)
    expect(state.onField.def).toBe('bea')
    expect(minutesPlayedMs(state, 'fay', 5 * MINUTE)).toBe(0)
  })

  it('does not jump the clock forward when a pause is undone', () => {
    const pausedAt = 100_000
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'CLOCK_PAUSE', at: pausedAt, clock: 5 * MINUTE },
    ]
    // Two minutes of real time pass while paused, then the coach undoes the pause.
    const now = pausedAt + 2 * MINUTE
    const { state } = undoLast(roster, init, events, now)

    expect(state.runningSince).not.toBeNull()
    // The clock resumes from where it was, not from where it would have been.
    expect(mins(currentClock(state, now))).toBe(5)
  })
})

describe('replay', () => {
  it('is deterministic: folding twice gives the same state', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'SUB', at: 0, clock: 5 * MINUTE, slotId: 'def', off: 'bea', on: 'fay' },
      { t: 'PERIOD_END', at: 0, clock: 10 * MINUTE },
      { t: 'CLOCK_START', at: 0, clock: 10 * MINUTE },
      { t: 'SUB', at: 0, clock: 15 * MINUTE, slotId: 'left', off: 'cleo', on: 'gia' },
      { t: 'MATCH_END', at: 0, clock: 20 * MINUTE },
    ]
    expect(foldMatch(roster, init, events)).toEqual(foldMatch(roster, init, events))
  })

  it('counts a period break as a pause, not as playing time', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'PERIOD_END', at: 0, clock: 10 * MINUTE },
      { t: 'CLOCK_START', at: 5 * MINUTE, clock: 10 * MINUTE },
      { t: 'MATCH_END', at: 0, clock: 20 * MINUTE },
    ]
    const state = foldMatch(roster, init, events)
    expect(state.period).toBe(2)
    expect(mins(minutesPlayedMs(state, 'bea', 20 * MINUTE))).toBe(20)
  })
})
