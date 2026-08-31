import { MINUTE, type MatchState, type Share } from './engine'
import type { Player, PlayerId, SlotId } from './types'

export interface ProposedSub {
  slotId: SlotId
  off: PlayerId
  on: PlayerId
  /** Minutes of unfairness this swap removes, for ordering and explanation. */
  gainMs: number
}

/** A player who has only just come on should not be hauled straight back off. */
const MIN_STINT_MS = 90_000

export interface SuggestOptions {
  /** Cap on how many changes to propose at one shift. */
  maxSubs?: number
  minStintMs?: number
}

/**
 * Propose a set of swaps for the next shift: the players furthest ahead of their share
 * come off, the ones furthest behind come on, and the incoming player inherits the
 * outgoing player's slot so the shape of the team is preserved.
 *
 * This only ever *proposes*. Nothing is applied without the coach confirming, because the
 * arithmetic does not know that one of them has just rolled an ankle.
 */
export function suggestSubs(
  roster: Player[],
  state: MatchState,
  shares: Share[],
  clock: number,
  options: SuggestOptions = {},
): ProposedSub[] {
  const maxSubs = options.maxSubs ?? state.slots.filter((s) => !s.isGK).length
  const minStint = options.minStintMs ?? MIN_STINT_MS
  const shareOf = new Map(shares.map((s) => [s.playerId, s]))
  const named = new Map(roster.map((p) => [p.id, p]))

  const outfieldSlots = state.slots.filter((s) => !s.isGK)

  // Candidates to come off: on the park, settled in, most over their share first.
  const comingOff = outfieldSlots
    .map((slot) => ({ slot, playerId: state.onField[slot.id] }))
    .filter((entry): entry is { slot: (typeof outfieldSlots)[number]; playerId: PlayerId } => {
      if (!entry.playerId) return false
      const start = state.stintStart[entry.playerId]
      return start === undefined ? false : clock - start >= minStint
    })
    .sort((a, b) => (shareOf.get(b.playerId)?.deltaMs ?? 0) - (shareOf.get(a.playerId)?.deltaMs ?? 0))

  // Candidates to come on: available, not already on, most owed time first.
  const comingOn = roster
    .filter((p) => named.has(p.id))
    .map((p) => shareOf.get(p.id))
    .filter((s): s is Share => !!s && s.available && !s.onField)
    .sort((a, b) => a.deltaMs - b.deltaMs)

  const proposals: ProposedSub[] = []
  const limit = Math.min(maxSubs, comingOff.length, comingOn.length)

  for (let i = 0; i < limit; i++) {
    const off = comingOff[i]
    const on = comingOn[i]
    const offDelta = shareOf.get(off.playerId)?.deltaMs ?? 0
    const gainMs = offDelta - on.deltaMs
    // Once the player coming on has had more than the one coming off, swapping would
    // make things worse rather than better.
    if (gainMs <= 0) break
    proposals.push({ slotId: off.slot.id, off: off.playerId, on: on.playerId, gainMs })
  }

  return matchPreferences(proposals, state, named)
}

/**
 * Reshuffle which vacated slot each incoming player takes so that, where possible, a girl
 * lands somewhere she likes playing. The set of who comes off and who goes on is already
 * decided — this only rearranges the destinations.
 */
function matchPreferences(
  proposals: ProposedSub[],
  state: MatchState,
  named: Map<PlayerId, Player>,
): ProposedSub[] {
  if (proposals.length < 2) return proposals

  const roleOf = (slotId: SlotId) => state.slots.find((s) => s.id === slotId)?.role
  const open = [...proposals]
  const assigned = new Map<PlayerId, ProposedSub>()

  // Girls with a matching preference choose first, so someone indifferent cannot walk
  // off with the one slot her teammate actually wanted.
  for (const proposal of proposals) {
    const preferred = named.get(proposal.on)?.preferred
    if (!preferred?.length) continue
    const index = open.findIndex((p) => {
      const role = roleOf(p.slotId)
      return role !== undefined && preferred.includes(role)
    })
    if (index >= 0) assigned.set(proposal.on, open.splice(index, 1)[0])
  }
  for (const proposal of proposals) {
    if (!assigned.has(proposal.on)) assigned.set(proposal.on, open.shift()!)
  }

  return proposals.map((p) => ({ ...assigned.get(p.on)!, on: p.on }))
}

/** Which shift number the clock is in, 1-based. */
export function shiftNumber(clock: number, shiftMinutes: number): number {
  return Math.floor(clock / (shiftMinutes * MINUTE)) + 1
}

/** Milliseconds until the next scheduled sub prompt. */
export function msToNextShift(clock: number, shiftMinutes: number): number {
  const period = shiftMinutes * MINUTE
  return period - (clock % period)
}
