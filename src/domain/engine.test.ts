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

const config = { totalMinutes: 20, periods: 1, shiftMinutes: 5, gkWeight: 0.5 }

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
  it('shares the day credit evenly when everyone is available', () => {
    const state = foldMatch(roster, init, [lineup(), { t: 'CLOCK_START', at: 0, clock: 0 }])
    const shares = fairShares(roster, state, config, 0)
    const byId = new Map(shares.map((s) => [s.playerId, s]))

    // 20 min x (4 outfield + half a keeper) = 90 credit-minutes over 10 players.
    expect(mins(byId.get('bea')!.targetMs)).toBeCloseTo(9, 1)
    expect(mins(byId.get('ava')!.targetMs)).toBeCloseTo(9, 1)
    expect(mins(shares.reduce((sum, s) => sum + s.targetMs, 0))).toBeCloseTo(90, 1)
  })

  it('counts a game in goal as half a game of running', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'MATCH_END', at: 0, clock: 20 * MINUTE },
    ]
    const state = foldMatch(roster, init, events)
    const byId = new Map(fairShares(roster, state, config, 20 * MINUTE).map((s) => [s.playerId, s]))

    const keeper = byId.get('ava')!
    const outfielder = byId.get('bea')!

    // Both were on for the full 20, but the keeper banks half the credit.
    expect(mins(keeper.playedMs)).toBe(20)
    expect(mins(keeper.gkMs)).toBe(20)
    expect(mins(keeper.creditMs)).toBe(10)
    expect(mins(outfielder.playedMs)).toBe(20)
    expect(mins(outfielder.creditMs)).toBe(20)

    // So she is only just ahead of her share, while the outfielder is well ahead.
    expect(mins(keeper.deltaMs)).toBeCloseTo(1, 1)
    expect(mins(outfielder.deltaMs)).toBeCloseTo(11, 1)
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

    // Five outfield slots instead of four: 20 x 5.5 = 110 credit over 10 players.
    expect(after.targetMs).toBeGreaterThan(before.targetMs)
    expect(mins(after.targetMs)).toBeCloseTo(11, 1)
  })
})

describe('match day', () => {
  it('carries credit from the first game into the second', () => {
    const state = foldMatch(roster, init, [lineup(), { t: 'CLOCK_START', at: 0, clock: 0 }])

    // Ava kept goal in game one; Jo never got on.
    const day = {
      priorCreditMs: { ava: 10 * MINUTE, bea: 20 * MINUTE, jo: 0 },
      dayCreditMs: 180 * MINUTE, // two games of 90
      starts: { ava: 1, bea: 1 },
      priorGkMs: { ava: 20 * MINUTE },
    }
    const byId = new Map(
      fairShares(roster, state, config, 0, day).map((s) => [s.playerId, s]),
    )

    // Everyone is chasing 18 credit-minutes across the day, not 9 in this game.
    expect(mins(byId.get('jo')!.targetMs)).toBeCloseTo(18, 1)
    // Jo is owed the most, then the keeper, and Bea least of all.
    expect(byId.get('jo')!.deltaMs).toBeLessThan(byId.get('ava')!.deltaMs)
    expect(byId.get('ava')!.deltaMs).toBeLessThan(byId.get('bea')!.deltaMs)
  })

  it('puts the first game keeper ahead of a full-game outfielder in the queue', () => {
    const state = foldMatch(roster, init, [
      {
        t: 'LINEUP',
        at: 1000,
        clock: 0,
        slots: DEFAULT_SLOTS,
        assignments: { gk: 'jo', def: 'ivy', left: 'hana', centre: 'gia', right: 'fay' },
      },
      { t: 'CLOCK_START', at: 0, clock: 0 },
    ])
    const day = {
      // Ava kept last game (10 credit), Bea ran the whole game (20 credit).
      priorCreditMs: { ava: 10 * MINUTE, bea: 20 * MINUTE },
      dayCreditMs: 180 * MINUTE,
      starts: { ava: 1, bea: 1 },
      priorGkMs: { ava: 20 * MINUTE },
    }
    const byId = new Map(fairShares(roster, state, config, 0, day).map((s) => [s.playerId, s]))
    expect(byId.get('ava')!.deltaMs).toBeLessThan(byId.get('bea')!.deltaMs)
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
