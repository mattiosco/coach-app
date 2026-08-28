import type { Availability, PlayerId, Slot, SlotId } from './types'

/**
 * Every event carries two clocks:
 *   `at`    wall-clock instant, for the record and for resuming a running clock.
 *   `clock` elapsed *game* milliseconds when it happened.
 *
 * Minutes are always derived from `clock`, never from `at`. Game time does not advance
 * while paused, so a stint is simply the difference between two clock readings — no
 * interval arithmetic, and immune to the phone sleeping or the app being backgrounded.
 */
export interface EventBase {
  at: number
  clock: number
}

export type MatchEvent = EventBase &
  (
    | { t: 'LINEUP'; assignments: Record<SlotId, PlayerId | null>; slots: Slot[] }
    | { t: 'CLOCK_START' }
    | { t: 'CLOCK_PAUSE' }
    | { t: 'SUB'; slotId: SlotId; off: PlayerId | null; on: PlayerId }
    | { t: 'SWAP'; slotA: SlotId; slotB: SlotId }
    | { t: 'SLOT_ADD'; slot: Slot; playerId: PlayerId | null }
    | { t: 'SLOT_REMOVE'; slotId: SlotId }
    | { t: 'PERIOD_END' }
    | { t: 'AVAILABILITY'; playerId: PlayerId; status: Availability }
    | { t: 'MATCH_END' }
  )

export type MatchEventType = MatchEvent['t']

/**
 * Omit distributes over each member of the union rather than collapsing it, so callers
 * can build an event without the two clock fields and keep the discriminated union.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** An event as the UI creates it: the clocks are stamped on when it is appended. */
export type NewMatchEvent = DistributiveOmit<MatchEvent, 'at' | 'clock'>

/** Human-readable one-liner for the event log / undo button. */
export function describeEvent(
  event: MatchEvent,
  nameOf: (id: PlayerId) => string,
  labelOf: (id: SlotId) => string,
): string {
  switch (event.t) {
    case 'LINEUP':
      return 'Starting line-up set'
    case 'CLOCK_START':
      return 'Clock started'
    case 'CLOCK_PAUSE':
      return 'Clock paused'
    case 'SUB':
      return event.off
        ? `${nameOf(event.on)} on for ${nameOf(event.off)} at ${labelOf(event.slotId)}`
        : `${nameOf(event.on)} on at ${labelOf(event.slotId)}`
    case 'SWAP':
      return `Swapped ${labelOf(event.slotA)} and ${labelOf(event.slotB)}`
    case 'SLOT_ADD':
      return `Added ${event.slot.label}`
    case 'SLOT_REMOVE':
      return `Removed ${labelOf(event.slotId)}`
    case 'PERIOD_END':
      return 'End of period'
    case 'AVAILABILITY':
      return `${nameOf(event.playerId)} marked ${event.status}`
    case 'MATCH_END':
      return 'Match ended'
  }
}
