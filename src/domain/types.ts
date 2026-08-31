export type PlayerId = string
export type SlotId = string
export type MatchId = string

/** Broad areas of the park a girl can prefer. Kept coarse so it survives formation changes. */
export type Role = 'GK' | 'Defence' | 'Midfield' | 'Attack'
export const ROLES: Role[] = ['GK', 'Defence', 'Midfield', 'Attack']

export interface Player {
  id: PlayerId
  name: string
  /** Optional preferred areas. Used to order pickers and steer suggestions, never to force. */
  preferred?: Role[]
}

/** A position on the park. `isGK` is pinned: the keeper never enters the rotation. */
export interface Slot {
  id: SlotId
  label: string
  isGK: boolean
  role?: Role
  /** Where the magnet sits on the pitch map, as a percentage of the box. */
  x?: number
  y?: number
}

export type Availability =
  | 'available' // on the field or on the bench
  | 'absent' // not at the ground
  | 'loaned' // lent to the other team; still playing, just in their shirt

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

/** Squadi match id where known, otherwise a local id. */
export interface Fixture {
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

const slot = (
  id: SlotId,
  label: string,
  role: Role,
  x: number,
  y: number,
): Slot => ({ id, label, isGK: role === 'GK', role, x, y })

/**
 * One formation per players-per-side count. Coordinates are laid out for the sideline
 * view: our goal at the bottom, attacking up the screen.
 */
export const FORMATIONS: Record<number, Slot[]> = {
  4: [
    slot('gk', 'GK', 'GK', 50, 87),
    slot('def', 'Defender', 'Defence', 50, 60),
    slot('left', 'Left', 'Attack', 28, 24),
    slot('right', 'Right', 'Attack', 72, 24),
  ],
  5: [
    slot('gk', 'GK', 'GK', 50, 87),
    slot('def', 'Defender', 'Defence', 50, 64),
    slot('left', 'Left', 'Attack', 19, 24),
    slot('centre', 'Centre', 'Attack', 50, 20),
    slot('right', 'Right', 'Attack', 81, 24),
  ],
  6: [
    slot('gk', 'GK', 'GK', 50, 87),
    slot('def', 'Defender', 'Defence', 50, 68),
    slot('mid', 'Mid', 'Midfield', 50, 46),
    slot('left', 'Left', 'Attack', 20, 26),
    slot('right', 'Right', 'Attack', 80, 26),
    slot('fwd', 'Striker', 'Attack', 50, 14),
  ],
  7: [
    slot('gk', 'GK', 'GK', 50, 88),
    slot('def_l', 'Def L', 'Defence', 30, 70),
    slot('def_r', 'Def R', 'Defence', 70, 70),
    slot('mid', 'Mid', 'Midfield', 50, 48),
    slot('left', 'Left', 'Attack', 22, 28),
    slot('right', 'Right', 'Attack', 78, 28),
    slot('fwd', 'Striker', 'Attack', 50, 14),
  ],
  8: [
    slot('gk', 'GK', 'GK', 50, 88),
    slot('def_l', 'Def L', 'Defence', 30, 70),
    slot('def_r', 'Def R', 'Defence', 70, 70),
    slot('mid_l', 'Mid L', 'Midfield', 26, 48),
    slot('mid_r', 'Mid R', 'Midfield', 74, 48),
    slot('left', 'Left', 'Attack', 20, 26),
    slot('right', 'Right', 'Attack', 80, 26),
    slot('fwd', 'Striker', 'Attack', 50, 14),
  ],
}

export const FORMATION_NAMES: Record<number, string> = {
  4: 'GK-1-2',
  5: 'GK-1-3',
  6: 'GK-1-1-2-1',
  7: 'GK-2-1-2-1',
  8: 'GK-2-2-2-1',
}

export function formationFor(count: number): Slot[] {
  return FORMATIONS[Math.min(8, Math.max(4, count))]
}

export const DEFAULT_SLOTS: Slot[] = FORMATIONS[5]

export const MID_SLOT: Slot = slot('mid', 'Mid', 'Midfield', 50, 45)

export const DEFAULT_CONFIG: MatchConfig = {
  totalMinutes: 20,
  periods: 1,
  shiftMinutes: 5,
  gkWeight: 0.5,
}

/**
 * Fallback spots for slots stored before coordinates lived on the slot itself, so old
 * matches still replay onto a sensible map.
 */
export const SLOT_POSITIONS: Record<string, { x: number; y: number }> = {
  gk: { x: 50, y: 87 },
  def: { x: 50, y: 66 },
  mid: { x: 50, y: 45 },
  left: { x: 19, y: 24 },
  centre: { x: 50, y: 20 },
  right: { x: 81, y: 24 },
}
