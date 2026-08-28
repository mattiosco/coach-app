import { SLOT_POSITIONS, type PlayerId, type Slot, type SlotId } from '../domain/types'

export interface MagnetInfo {
  /** Who is filling the slot right now. */
  playerId: PlayerId | null
  /** Who is coming on here, once the planned sub is made. */
  incoming?: PlayerId | null
}

/**
 * Spots for positions added mid-game, when the other coach agrees to more players.
 *
 * They flank the centre rather than sitting on it: Mid already owns the middle, and two
 * magnets on the same coordinates is worse than useless — you cannot tap the one behind.
 */
const EXTRA_SPOTS = [
  { x: 22, y: 45 },
  { x: 78, y: 45 },
  { x: 33, y: 58 },
  { x: 67, y: 58 },
  { x: 12, y: 33 },
  { x: 88, y: 33 },
]

function layout(slots: Slot[]): (slot: Slot) => { x: number; y: number } {
  const extras = slots.filter((s) => !SLOT_POSITIONS[s.id])
  return (slot) => {
    const known = SLOT_POSITIONS[slot.id]
    if (known) return known
    const i = extras.indexOf(slot)
    return EXTRA_SPOTS[i % EXTRA_SPOTS.length]
  }
}

/**
 * The team laid out as it stands on the park, with names big enough to read from the
 * sideline. The girls look at this to see where they are going, so position labels stay
 * small and names stay large.
 */
export default function PitchMap({
  slots,
  fill,
  nameOf,
  selectedSlotId,
  onSlotTap,
}: {
  slots: Slot[]
  fill: (slotId: SlotId) => MagnetInfo
  nameOf: (id: PlayerId | null) => string
  selectedSlotId?: SlotId | null
  onSlotTap: (slotId: SlotId) => void
}) {
  const positionOf = layout(slots)

  return (
    <div className="pitch">
      <div className="goal-box top" />
      <div className="goal-box bottom" />

      {slots.map((slot) => {
        const { x, y } = positionOf(slot)
        const info = fill(slot.id)
        const planned = !!info.incoming

        return (
          <button
            key={slot.id}
            className={[
              'magnet',
              slot.isGK ? 'gk' : '',
              info.playerId ? '' : 'empty',
              planned ? 'planned' : '',
              selectedSlotId === slot.id ? 'selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ left: `${x}%`, top: `${y}%` }}
            onClick={() => onSlotTap(slot.id)}
          >
            <span className="pos">{slot.label}</span>
            <span className="who">{info.playerId ? nameOf(info.playerId) : 'Tap'}</span>
            {planned && <span className="incoming">▼ {nameOf(info.incoming ?? null)}</span>}
          </button>
        )
      })}
    </div>
  )
}
