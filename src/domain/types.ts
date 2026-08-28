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
}
