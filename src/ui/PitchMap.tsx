import { useEffect, useRef } from 'react'
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
  const hasSpot = (s: Slot) => s.x !== undefined || SLOT_POSITIONS[s.id] !== undefined
  const extras = slots.filter((s) => !hasSpot(s))
  return (slot) => {
    // Formation slots carry their own coordinates; older stored slots fall back to the
    // legacy map, and anything unnamed flanks the centre.
    if (slot.x !== undefined && slot.y !== undefined) return { x: slot.x, y: slot.y }
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
  onSlotHold,
  shuffling = false,
}: {
  slots: Slot[]
  fill: (slotId: SlotId) => MagnetInfo
  nameOf: (id: PlayerId | null) => string
  selectedSlotId?: SlotId | null
  onSlotTap: (slotId: SlotId) => void
  /** Held down on a magnet — used to start moving players around. */
  onSlotHold?: (slotId: SlotId) => void
  shuffling?: boolean
}) {
  const positionOf = layout(slots)
  const holdTimer = useRef<number | undefined>(undefined)
  const held = useRef(false)

  useEffect(() => () => window.clearTimeout(holdTimer.current), [])

  const startHold = (slotId: SlotId) => {
    if (!onSlotHold) return
    held.current = false
    window.clearTimeout(holdTimer.current)
    holdTimer.current = window.setTimeout(() => {
      held.current = true
      navigator.vibrate?.(30)
      onSlotHold(slotId)
    }, 450)
  }
  const cancelHold = () => window.clearTimeout(holdTimer.current)

  return (
    <div className={`pitch${shuffling ? ' shuffling' : ''}`}>
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
            onPointerDown={() => startHold(slot.id)}
            onPointerUp={cancelHold}
            onPointerLeave={cancelHold}
            onPointerCancel={cancelHold}
            onContextMenu={(e) => e.preventDefault()}
            onClick={() => {
              // A completed hold already did its job; do not also treat it as a tap.
              if (held.current) {
                held.current = false
                return
              }
              onSlotTap(slot.id)
            }}
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
