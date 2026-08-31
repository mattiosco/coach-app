import { describe, expect, it } from 'vitest'
import {
  MINUTE,
  creditMs,
  currentClock,
  fairShares,
  foldMatch,
  minutesPlayedMs,
  undoLast,
  type MatchInit,
} from './engine'
import type { MatchEvent } from './events'
import { suggestSubs } from './suggest'
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

  it('counts time lent to the other team as a full run', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'AVAILABILITY', at: 0, clock: 10 * MINUTE, playerId: 'jo', status: 'loaned' },
      { t: 'MATCH_END', at: 0, clock: 20 * MINUTE },
    ]
    const state = foldMatch(roster, init, events)
    const byId = new Map(fairShares(roster, state, config, 20 * MINUTE).map((s) => [s.playerId, s]))
    const jo = byId.get('jo')!
    const staying = byId.get('gia')!

    // She played ten minutes for the other team, and that is ten minutes of running.
    expect(mins(jo.playedMs)).toBe(10)
    expect(mins(jo.creditMs)).toBe(10)
    // She keeps a full share rather than a prorated one: she was there all game.
    expect(jo.targetMs).toBeCloseTo(staying.targetMs, 5)
    // And she is ahead of a girl who sat on our bench the whole time.
    expect(jo.deltaMs).toBeGreaterThan(staying.deltaMs)
  })

  it('does not send a lent player to the front of the queue next game', () => {
    const lent: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'AVAILABILITY', at: 0, clock: 0, playerId: 'jo', status: 'loaned' },
      { t: 'MATCH_END', at: 0, clock: 20 * MINUTE },
    ]
    const state = foldMatch(roster, init, lent)
    const clock = 20 * MINUTE
    // A full game lent out is a full game of credit carried into the next match.
    expect(mins(creditMs(state, 'jo', clock, config.gkWeight))).toBe(20)
    // Whereas an unused sub carries nothing.
    expect(mins(creditMs(state, 'hana', clock, config.gkWeight))).toBe(0)
  })

  it('pulls a loaned player off the park automatically', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'AVAILABILITY', at: 0, clock: 6 * MINUTE, playerId: 'cleo', status: 'loaned' },
    ]
    const state = foldMatch(roster, init, events)
    expect(state.onField.left).toBeNull()
    // Six minutes for us, then nine for them: still fifteen minutes of football.
    expect(mins(minutesPlayedMs(state, 'cleo', 15 * MINUTE))).toBe(15)
  })

  it('gives a late arrival a share of only the time she is there for', () => {
    const lateInit: MatchInit = {
      slots: DEFAULT_SLOTS,
      availability: { jo: 'absent' },
    }
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      // Jo turns up at the ten minute mark.
      { t: 'AVAILABILITY', at: 0, clock: 10 * MINUTE, playerId: 'jo', status: 'available' },
    ]
    const state = foldMatch(roster, lateInit, events)
    const byId = new Map(
      fairShares(roster, state, config, 10 * MINUTE).map((s) => [s.playerId, s]),
    )
    const jo = byId.get('jo')!
    const allGame = byId.get('gia')!

    // She is available for half the match, so she is owed about half a share rather than
    // appearing to be the most robbed girl on the team.
    expect(jo.targetMs).toBeGreaterThan(0)
    expect(jo.targetMs / allGame.targetMs).toBeCloseTo(0.5, 1)
    expect(jo.available).toBe(true)
  })

  it('stops the clock for a player who has gone home', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'AVAILABILITY', at: 0, clock: 6 * MINUTE, playerId: 'cleo', status: 'absent' },
    ]
    const state = foldMatch(roster, init, events)
    const byId = new Map(fairShares(roster, state, config, 15 * MINUTE).map((s) => [s.playerId, s]))
    // Absent is not lent: her time stops, and her share shrinks to what she was there for.
    expect(mins(minutesPlayedMs(state, 'cleo', 15 * MINUTE))).toBe(6)
    expect(byId.get('cleo')!.targetMs).toBeLessThan(byId.get('gia')!.targetMs)
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
      priorPlayedMs: { ava: 20 * MINUTE, bea: 20 * MINUTE, jo: 0 },
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

  it('asks only for what this match can give, counting the earlier game', () => {
    const state = foldMatch(roster, init, [lineup(), { t: 'CLOCK_START', at: 0, clock: 0 }])
    const day = {
      priorCreditMs: { bea: 14 * MINUTE, jo: 2 * MINUTE },
      priorPlayedMs: { bea: 14 * MINUTE, jo: 2 * MINUTE },
      dayCreditMs: 180 * MINUTE,
      starts: { bea: 1 },
      priorGkMs: {},
    }
    const byId = new Map(fairShares(roster, state, config, 0, day).map((s) => [s.playerId, s]))

    // Everyone is chasing 18 across the day...
    expect(mins(byId.get('bea')!.targetMs)).toBeCloseTo(18, 1)
    // ...but this match only owes them the remainder of it.
    expect(mins(byId.get('bea')!.gameTargetMs)).toBeCloseTo(4, 1)
    expect(mins(byId.get('jo')!.gameTargetMs)).toBeCloseTo(16, 1)
    // Someone who did not play earlier is owed a full day's share in this one game.
    expect(mins(byId.get('hana')!.gameTargetMs)).toBeCloseTo(18, 1)
    // The earlier game's minutes are carried, not forgotten.
    expect(mins(byId.get('bea')!.priorCreditMs)).toBe(14)
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
      priorPlayedMs: { ava: 20 * MINUTE, bea: 20 * MINUTE },
      dayCreditMs: 180 * MINUTE,
      starts: { ava: 1, bea: 1 },
      priorGkMs: { ava: 20 * MINUTE },
    }
    const byId = new Map(fairShares(roster, state, config, 0, day).map((s) => [s.playerId, s]))
    expect(byId.get('ava')!.deltaMs).toBeLessThan(byId.get('bea')!.deltaMs)
  })
})

describe('goalkeeper subs', () => {
  it('splits the buckets when the keeper swaps with an outfielder at half time', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      // Half time: Ava comes out of goal, Bea goes in, both stay on the park.
      { t: 'SWAP', at: 0, clock: 10 * MINUTE, slotA: 'gk', slotB: 'def' },
      { t: 'MATCH_END', at: 0, clock: 20 * MINUTE },
    ]
    const state = foldMatch(roster, init, events)
    const byId = new Map(
      fairShares(roster, state, config, 20 * MINUTE).map((s) => [s.playerId, s]),
    )

    // Each played the full 20, half of it in goal.
    expect(mins(byId.get('ava')!.playedMs)).toBe(20)
    expect(mins(byId.get('ava')!.gkMs)).toBe(10)
    expect(mins(byId.get('bea')!.gkMs)).toBe(10)
    // Credit: 10 outfield + 10 in goal at half rate = 15 each.
    expect(mins(byId.get('ava')!.creditMs)).toBe(15)
    expect(mins(byId.get('bea')!.creditMs)).toBe(15)
  })

  it('handles the keeper going to the bench for a fresh one', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'SUB', at: 0, clock: 10 * MINUTE, slotId: 'gk', off: 'ava', on: 'jo' },
      { t: 'MATCH_END', at: 0, clock: 20 * MINUTE },
    ]
    const state = foldMatch(roster, init, events)
    const byId = new Map(
      fairShares(roster, state, config, 20 * MINUTE).map((s) => [s.playerId, s]),
    )
    expect(mins(byId.get('ava')!.gkMs)).toBe(10)
    expect(mins(byId.get('ava')!.creditMs)).toBe(5)
    expect(mins(byId.get('jo')!.gkMs)).toBe(10)
    expect(mins(byId.get('jo')!.creditMs)).toBe(5)
  })
})

describe('preferred positions', () => {
  it('steers an incoming player toward a slot she likes', () => {
    const picky: Player[] = roster.map((p) =>
      p.id === 'jo' ? { ...p, preferred: ['Defence' as const] } : p,
    )
    // Only Fay and Jo on the bench, so both certainly come on. Fay is first in owed
    // order and has no preference; without preference-first matching she would take the
    // defender slot Jo actually wants.
    const pickyInit: MatchInit = {
      slots: DEFAULT_SLOTS,
      availability: { gia: 'absent', hana: 'absent', ivy: 'absent' },
    }
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
    ]
    const state = foldMatch(picky, pickyInit, events)
    const clock = 10 * MINUTE
    const shares = fairShares(picky, state, config, clock)
    const proposals = suggestSubs(picky, state, shares, clock)

    // Jo prefers defence, so whichever swap she is part of should hand her the def slot.
    const jos = proposals.find((p) => p.on === 'jo')
    expect(jos).toBeDefined()
    expect(jos!.slotId).toBe('def')
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
