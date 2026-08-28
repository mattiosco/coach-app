import { slotPosition, type PlayerId, type Slot, type SlotId } from '../domain/types'

export interface MagnetInfo {
  /** Who is filling the slot right now. */
  playerId: PlayerId | null
  /** Who is coming on here, once the planned sub is made. */
  incoming?: PlayerId | null
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
  return (
    <div className="pitch">
      <div className="goal-box top" />
      <div className="goal-box bottom" />

      {slots.map((slot, index) => {
        const { x, y } = slotPosition(slot.id, index)
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
