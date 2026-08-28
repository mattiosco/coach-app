export type PlayerId = string
export type SlotId = string
export type MatchId = string

export interface Player {
  id: PlayerId
  name: string
}

/** A position on the park. `isGK` is pinned: the keeper never enters the rotation. */
export interface Slot {
  id: SlotId
  label: string
  isGK: boolean
}

export type Availability =
  | 'available' // on the field or on the bench
  | 'absent' // not at the ground
  | 'loaned' // lent to the other team; her clock stops

export interface MatchConfig {
  /** Total running minutes, excluding any break. */
  totalMinutes: number
  /**
   * 1 = straight through, 2 = swap ends at the halfway mark. Decided by the game leader
   * on the day, so this is never imported from the fixture — it starts at 1 and the game
   * screen has a Half time button for when it happens.
   */
  periods: number
  /** How often to prompt for a rolling sub. */
  shiftMinutes: number
  /**
   * How much a minute in goal counts toward a player's share of running around.
   * The keeper is on all game but does far less work, so half a minute of credit per
   * minute kept means she has "had a game" without being pushed to the back of the
   * queue for outfield time in the day's other match.
   */
  gkWeight: number
}

export interface Fixture {
  /** Squadi match id where known, otherwise a local id. */
  id: string
  round: string
  /** ISO instant of kickoff. */
  startTime: string
  opponent: string
  homeAway: 'home' | 'away'
  venue: string
  /** Config as Squadi describes it — the coach can override per match. */
  config: MatchConfig
  /** True once edited by hand, so a re-sync does not clobber the correction. */
  edited?: boolean
  /** Absent for fixtures added manually. */
  source?: 'squadi' | 'manual'
}

export const DEFAULT_SLOTS: Slot[] = [
  { id: 'gk', label: 'GK', isGK: true },
  { id: 'def', label: 'Defender', isGK: false },
  { id: 'left', label: 'Left', isGK: false },
  { id: 'centre', label: 'Centre', isGK: false },
  { id: 'right', label: 'Right', isGK: false },
]

export const MID_SLOT: Slot = { id: 'mid', label: 'Mid', isGK: false }

export const DEFAULT_CONFIG: MatchConfig = {
  totalMinutes: 20,
  periods: 1,
  shiftMinutes: 5,
  gkWeight: 0.5,
}

/**
 * Where each position sits on the pitch map, as a percentage of the box. The girls read
 * this from the sideline, so the shape has to match what they see facing the park.
 */
export const SLOT_POSITIONS: Record<string, { x: number; y: number }> = {
  gk: { x: 50, y: 87 },
  def: { x: 50, y: 66 },
  mid: { x: 50, y: 45 },
  left: { x: 19, y: 24 },
  centre: { x: 50, y: 20 },
  right: { x: 81, y: 24 },
}

/** Fallback for slots added mid-game, spread along the front. */
export function slotPosition(slotId: string, index: number): { x: number; y: number } {
  return SLOT_POSITIONS[slotId] ?? { x: 12 + ((index * 27) % 76), y: 40 }
}
