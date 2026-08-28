import type { MatchEvent } from './events'
import type { Availability, MatchConfig, Player, PlayerId, Slot, SlotId } from './types'

export interface MatchState {
  slots: Slot[]
  /** Slot -> player currently filling it. */
  onField: Record<SlotId, PlayerId | null>
  /** Game ms banked before the current running span. */
  accumulatedMs: number
  /** Wall-clock instant the clock was last started, or null when paused. */
  runningSince: number | null
  period: number
  ended: boolean
  availability: Record<PlayerId, Availability>
  /** Game ms from completed stints only. */
  playedMs: Record<PlayerId, number>
  /** Game-clock reading when the current stint began. */
  stintStart: Record<PlayerId, number | undefined>
  availableMs: Record<PlayerId, number>
  availableSince: Record<PlayerId, number | undefined>
}

export interface MatchInit {
  slots: Slot[]
  availability: Record<PlayerId, Availability>
}

export const MINUTE = 60_000

export function totalMatchMs(config: MatchConfig): number {
  return config.totalMinutes * MINUTE
}

/**
 * Rebuild match state from the event log. This is the only way state is produced, which
 * is what makes undo, mid-match correction and crash recovery fall out for free.
 */
export function foldMatch(roster: Player[], init: MatchInit, events: MatchEvent[]): MatchState {
  const state: MatchState = {
    slots: [...init.slots],
    onField: Object.fromEntries(init.slots.map((s) => [s.id, null])),
    accumulatedMs: 0,
    runningSince: null,
    period: 1,
    ended: false,
    availability: {},
    playedMs: {},
    stintStart: {},
    availableMs: {},
    availableSince: {},
  }

  for (const player of roster) {
    const status = init.availability[player.id] ?? 'available'
    state.availability[player.id] = status
    state.playedMs[player.id] = 0
    state.availableMs[player.id] = 0
    state.availableSince[player.id] = status === 'available' ? 0 : undefined
  }

  const startStint = (id: PlayerId, clock: number) => {
    if (state.stintStart[id] === undefined) state.stintStart[id] = clock
  }
  const endStint = (id: PlayerId | null, clock: number) => {
    if (!id) return
    const start = state.stintStart[id]
    if (start === undefined) return
    state.playedMs[id] = (state.playedMs[id] ?? 0) + Math.max(0, clock - start)
    state.stintStart[id] = undefined
  }

  for (const event of events) {
    switch (event.t) {
      case 'LINEUP': {
        state.slots = [...event.slots]
        // Close any stints from a line-up being replaced before kick-off.
        for (const id of Object.values(state.onField)) endStint(id, event.clock)
        state.onField = { ...event.assignments }
        for (const id of Object.values(event.assignments)) {
          if (id) startStint(id, event.clock)
        }
        break
      }

      case 'CLOCK_START':
        state.accumulatedMs = event.clock
        state.runningSince = event.at
        break

      case 'CLOCK_PAUSE':
        state.accumulatedMs = event.clock
        state.runningSince = null
        break

      case 'SUB':
        endStint(event.off, event.clock)
        state.onField[event.slotId] = event.on
        startStint(event.on, event.clock)
        break

      case 'SWAP': {
        // A positional swap, not a substitution: both players stay on, so their stints
        // continue untouched.
        const a = state.onField[event.slotA] ?? null
        const b = state.onField[event.slotB] ?? null
        state.onField[event.slotA] = b
        state.onField[event.slotB] = a
        break
      }

      case 'SLOT_ADD':
        state.slots = [...state.slots, event.slot]
        state.onField[event.slot.id] = event.playerId ?? null
        if (event.playerId) startStint(event.playerId, event.clock)
        break

      case 'SLOT_REMOVE':
        endStint(state.onField[event.slotId] ?? null, event.clock)
        state.slots = state.slots.filter((s) => s.id !== event.slotId)
        delete state.onField[event.slotId]
        break

      case 'PERIOD_END':
        state.period += 1
        state.accumulatedMs = event.clock
        state.runningSince = null
        break

      case 'AVAILABILITY': {
        const previous = state.availability[event.playerId]
        if (previous === 'available' && event.status !== 'available') {
          const since = state.availableSince[event.playerId]
          if (since !== undefined) {
            state.availableMs[event.playerId] += Math.max(0, event.clock - since)
            state.availableSince[event.playerId] = undefined
          }
          // Someone lent out or gone home cannot still be on the park.
          for (const [slotId, id] of Object.entries(state.onField)) {
            if (id === event.playerId) {
              endStint(id, event.clock)
              state.onField[slotId] = null
            }
          }
        } else if (previous !== 'available' && event.status === 'available') {
          state.availableSince[event.playerId] = event.clock
        }
        state.availability[event.playerId] = event.status
        break
      }

      case 'MATCH_END':
        for (const id of Object.values(state.onField)) endStint(id, event.clock)
        for (const player of roster) {
          const since = state.availableSince[player.id]
          if (since !== undefined) {
            state.availableMs[player.id] += Math.max(0, event.clock - since)
            state.availableSince[player.id] = undefined
          }
        }
        state.accumulatedMs = event.clock
        state.runningSince = null
        state.ended = true
        break
    }
  }

  return state
}

/** Current game-clock reading in ms. */
export function currentClock(state: MatchState, now: number): number {
  return state.runningSince === null
    ? state.accumulatedMs
    : state.accumulatedMs + Math.max(0, now - state.runningSince)
}

export function minutesPlayedMs(state: MatchState, id: PlayerId, clock: number): number {
  const start = state.stintStart[id]
  const open = start === undefined ? 0 : Math.max(0, clock - start)
  return (state.playedMs[id] ?? 0) + open
}

export function isOnField(state: MatchState, id: PlayerId): boolean {
  return Object.values(state.onField).includes(id)
}

export function goalkeeperId(state: MatchState): PlayerId | null {
  const gk = state.slots.find((s) => s.isGK)
  return gk ? (state.onField[gk.id] ?? null) : null
}

/**
 * How long this player is expected to be available across the whole match, assuming her
 * current status holds to full time. Loans and late arrivals therefore reduce her share
 * rather than making her look robbed.
 */
export function projectedAvailableMs(
  state: MatchState,
  id: PlayerId,
  clock: number,
  totalMs: number,
): number {
  const since = state.availableSince[id]
  const banked =
    (state.availableMs[id] ?? 0) + (since === undefined ? 0 : Math.max(0, clock - since))
  const remaining = state.availability[id] === 'available' ? Math.max(0, totalMs - clock) : 0
  return banked + remaining
}

export interface Share {
  playerId: PlayerId
  playedMs: number
  targetMs: number
  /** Positive means ahead of her share, negative means owed time. */
  deltaMs: number
  onField: boolean
  available: boolean
}

/**
 * Fair share of outfield minutes, weighted by how long each player is actually available.
 *
 * The keeper is excluded entirely: she is pinned for the whole game, so including her
 * would drag every other target down and make the rotation look unfair when it is not.
 */
export function fairShares(
  roster: Player[],
  state: MatchState,
  config: MatchConfig,
  clock: number,
): Share[] {
  const totalMs = totalMatchMs(config)
  const outfieldSlots = state.slots.filter((s) => !s.isGK).length
  const gk = goalkeeperId(state)

  const pool = roster.filter((p) => p.id !== gk && state.availability[p.id] !== 'absent')
  const weights = new Map(
    pool.map((p) => [p.id, projectedAvailableMs(state, p.id, clock, totalMs)]),
  )
  const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0)
  const outfieldPlayerMs = totalMs * outfieldSlots

  return roster.map((player) => {
    const playedMs = minutesPlayedMs(state, player.id, clock)
    const weight = weights.get(player.id) ?? 0
    const targetMs =
      player.id === gk || totalWeight === 0 ? 0 : (outfieldPlayerMs * weight) / totalWeight
    return {
      playerId: player.id,
      playedMs,
      targetMs,
      deltaMs: playedMs - targetMs,
      onField: isOnField(state, player.id),
      available: state.availability[player.id] === 'available',
    }
  })
}

/**
 * Drop the last event and rebuild. The clock is re-anchored so the displayed time does
 * not jump: undoing a pause should not silently credit the paused minutes.
 */
export function undoLast(
  roster: Player[],
  init: MatchInit,
  events: MatchEvent[],
  now: number,
): { events: MatchEvent[]; state: MatchState } {
  if (events.length === 0) return { events, state: foldMatch(roster, init, events) }
  const dropped = events[events.length - 1]
  const remaining = events.slice(0, -1)
  const state = foldMatch(roster, init, remaining)
  if (state.runningSince !== null) {
    state.runningSince = now - Math.max(0, dropped.clock - state.accumulatedMs)
  }
  return { events: remaining, state }
}
