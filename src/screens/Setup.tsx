import { useMemo, useState } from 'react'
import type { MatchEvent } from '../domain/events'
import { MINUTE, fairShares, foldMatch } from '../domain/engine'
import { DEFAULT_SLOTS, MID_SLOT, type PlayerId, type Slot, type SlotId } from '../domain/types'
import { dayContextFor, useSeason, type SetupDraft, type StoredMatch } from '../state/store'
import PitchMap from '../ui/PitchMap'

const emptyDraft = (slots: Slot[]): SetupDraft => ({
  absent: [],
  gk: null,
  assignments: Object.fromEntries(slots.map((s) => [s.id, null])),
  slots,
})

/**
 * Pre-match. Who is here, who is in goal, and who starts.
 *
 * Every change is written straight to the stored match, so the line-up can be built at
 * home on Thursday night and still be there at the ground on Friday.
 */
export default function Setup({ match, onLeave }: { match: StoredMatch; onLeave: () => void }) {
  const { season, dispatch } = useSeason()
  const draft = match.draft ?? emptyDraft(DEFAULT_SLOTS)
  const [picking, setPicking] = useState<SlotId | null>(null)

  const update = (patch: Partial<SetupDraft>) =>
    dispatch({ type: 'SET_DRAFT', id: match.id, draft: { ...draft, ...patch } })

  const slots = draft.slots
  const outfieldSlots = slots.filter((s) => !s.isGK)
  const gkSlot = slots.find((s) => s.isGK)
  const absent = new Set(draft.absent)

  const present = season.players.filter((p) => !absent.has(p.id))
  const taken = new Set(Object.values(draft.assignments).filter(Boolean) as PlayerId[])

  // Who is owed time, taking the day's other game into account if it has been played.
  const day = useMemo(() => dayContextFor(season, match), [season, match])
  const shares = useMemo(() => {
    const state = foldMatch(season.players, { slots, availability: {} }, [])
    return new Map(
      fairShares(season.players, state, match.config, 0, day).map((s) => [s.playerId, s]),
    )
  }, [season.players, slots, match.config, day])

  const owedFirst = [...present].sort(
    (a, b) => (shares.get(a.id)?.deltaMs ?? 0) - (shares.get(b.id)?.deltaMs ?? 0),
  )

  const ready = draft.gk !== null && outfieldSlots.every((s) => draft.assignments[s.id])

  const playedEarlier = present.some((p) => (shares.get(p.id)?.priorCreditMs ?? 0) > 0)

  /**
   * Fill the line-up from who is owed most.
   *
   * The keeper is chosen from those who have not kept today, preferring whoever has had
   * the most running already — she loses the least by going in goal. The four most owed
   * of the rest start.
   */
  const suggestLineup = () => {
    const kept = new Set(
      present.filter((p) => (day.priorGkMs[p.id] ?? 0) > 0).map((p) => p.id),
    )
    const keeperPool = present.filter((p) => !kept.has(p.id))
    const keeper = [...(keeperPool.length ? keeperPool : present)].sort(
      (a, b) => (shares.get(b.id)?.dayCreditMs ?? 0) - (shares.get(a.id)?.dayCreditMs ?? 0),
    )[0]
    if (!keeper) return

    const rest = owedFirst.filter((p) => p.id !== keeper.id)
    const assignments: Record<SlotId, PlayerId | null> = {}
    outfieldSlots.forEach((slot, i) => {
      assignments[slot.id] = rest[i]?.id ?? null
    })
    if (gkSlot) assignments[gkSlot.id] = keeper.id
    update({ gk: keeper.id, assignments })
    setPicking(null)
  }

  const assign = (slotId: SlotId, playerId: PlayerId | null) => {
    const next = { ...draft.assignments }
    // A player can only be in one place, so clear her from anywhere else first.
    for (const key of Object.keys(next)) if (next[key] === playerId) next[key] = null
    next[slotId] = playerId
    update({ assignments: next })
    setPicking(null)
  }

  const setSixASide = (on: boolean) => {
    const nextSlots = on ? [...DEFAULT_SLOTS, MID_SLOT] : DEFAULT_SLOTS
    const next: Record<SlotId, PlayerId | null> = {}
    for (const slot of nextSlots) next[slot.id] = draft.assignments[slot.id] ?? null
    update({ slots: nextSlots, assignments: next })
  }

  const start = () => {
    if (!draft.gk || !gkSlot) return
    const assignments = { ...draft.assignments, [gkSlot.id]: draft.gk }
    const availability = Object.fromEntries(
      season.players.map((p) => [p.id, absent.has(p.id) ? 'absent' : 'available'] as const),
    )

    dispatch({
      type: 'START_MATCH',
      match: { ...match, init: { slots, availability }, events: [] },
    })
    const event: MatchEvent = { t: 'LINEUP', at: Date.now(), clock: 0, slots, assignments }
    dispatch({ type: 'APPEND', id: match.id, event })
  }

  if (season.players.length < 2) {
    return (
      <div className="screen">
        <h2 style={{ fontSize: 24 }}>Add the squad first</h2>
        <p className="muted small">You need players before you can set up a match.</p>
      </div>
    )
  }

  const nameOf = (id: PlayerId | null) => season.players.find((p) => p.id === id)?.name ?? '—'
  const pickingSlot = picking ? slots.find((s) => s.id === picking) : null
  const candidates = pickingSlot?.isGK ? present : present.filter((p) => p.id !== draft.gk)

  const pickPlayer = (playerId: PlayerId) => {
    if (!pickingSlot) return
    if (pickingSlot.isGK) {
      update({
        gk: draft.gk === playerId ? null : playerId,
        assignments: Object.fromEntries(
          Object.entries(draft.assignments).map(([k, v]) => [k, v === playerId ? null : v]),
        ),
      })
      setPicking(null)
      return
    }
    assign(pickingSlot.id, playerId)
  }

  return (
    <div className="screen">
      <h2 style={{ fontSize: 20, marginBottom: 2 }}>{match.label}</h2>
      {match.venue && (
        <p className="small" style={{ margin: '0 0 4px', color: 'var(--amber)' }}>
          {match.venue}
        </p>
      )}
      <p className="muted small" style={{ margin: '0 0 14px' }}>
        {match.config.totalMinutes} min · sub every {match.config.shiftMinutes} min
      </p>

      <PitchMap
        slots={slots}
        nameOf={nameOf}
        selectedSlotId={picking}
        fill={(slotId) => ({
          playerId: slots.find((s) => s.id === slotId)?.isGK
            ? draft.gk
            : (draft.assignments[slotId] ?? null),
        })}
        onSlotTap={(slotId) => setPicking(picking === slotId ? null : slotId)}
      />

      {pickingSlot ? (
        <>
          <div className="section-title">
            WHO PLAYS {pickingSlot.label.toUpperCase()}? — MOST OWED FIRST
          </div>
          <div className="bench-strip">
            {owedFirst
              .filter((p) => candidates.includes(p))
              .map((player) => {
                const placed = taken.has(player.id) || draft.gk === player.id
                const share = shares.get(player.id)
                const owed = share ? Math.round(-share.deltaMs / MINUTE) : 0
                return (
                  <button
                    key={player.id}
                    className="bench-chip"
                    style={{ opacity: placed ? 0.5 : 1 }}
                    onClick={() => pickPlayer(player.id)}
                  >
                    <span className="who">{player.name}</span>
                    <span className="slot-label">
                      {placed ? 'already on' : owed > 0 ? `owed ${owed} min` : 'even'}
                    </span>
                  </button>
                )
              })}
          </div>
          <button
            className="btn-ghost btn-block btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => {
              if (pickingSlot.isGK) update({ gk: null })
              else assign(pickingSlot.id, null)
              setPicking(null)
            }}
          >
            Leave {pickingSlot.label} empty
          </button>
        </>
      ) : (
        <p className="muted small" style={{ margin: '12px 0 0', lineHeight: 1.5 }}>
          Tap a position to choose who plays there. The keeper is the green one at the
          bottom. Everything here is saved as you go.
        </p>
      )}

      {playedEarlier && (
        <>
          <div className="section-title">EARLIER TODAY — MOST OWED FIRST</div>
          <div className="card">
            {owedFirst.map((player) => {
              const share = shares.get(player.id)
              const earlier = Math.round((share?.priorPlayedMs ?? 0) / MINUTE)
              const inGoal = Math.round((share?.priorGkMs ?? 0) / MINUTE)
              const owed = Math.round((share?.gameTargetMs ?? 0) / MINUTE)
              const starting =
                draft.gk === player.id || Object.values(draft.assignments).includes(player.id)
              return (
                <div className="row" key={player.id}>
                  <span
                    className="grow"
                    style={{ fontWeight: earlier === 0 ? 700 : 400, color: earlier === 0 ? 'var(--amber)' : undefined }}
                  >
                    {player.name}
                    {starting && <span className="muted small"> · starting</span>}
                  </span>
                  <span className="muted small" style={{ marginRight: 10 }}>
                    {earlier === 0
                      ? 'no minutes yet'
                      : `${earlier} min${inGoal > 0 ? ' in goal' : ''}`}
                  </span>
                  <span className={`pill ${owed > 0 ? 'behind' : 'level'}`}>owed {owed}</span>
                </div>
              )
            })}
          </div>
          <button className="btn-block" style={{ marginTop: 10 }} onClick={suggestLineup}>
            Pick the line-up from who is owed most
          </button>
        </>
      )}

      <div className="section-title">WHO IS HERE</div>
      <div className="card">
        <div className="row wrap" style={{ gap: 6 }}>
          {season.players.map((player) => {
            const here = !absent.has(player.id)
            return (
              <button
                key={player.id}
                className="btn-sm"
                style={{
                  borderColor: here ? 'var(--green)' : 'var(--line)',
                  color: here ? 'var(--text)' : 'var(--muted)',
                  opacity: here ? 1 : 0.55,
                }}
                onClick={() => {
                  update({
                    absent: here
                      ? [...draft.absent, player.id]
                      : draft.absent.filter((id) => id !== player.id),
                    assignments: here
                      ? Object.fromEntries(
                          Object.entries(draft.assignments).map(([k, v]) => [
                            k,
                            v === player.id ? null : v,
                          ]),
                        )
                      : draft.assignments,
                    gk: here && draft.gk === player.id ? null : draft.gk,
                  })
                }}
              >
                {player.name}
              </button>
            )
          })}
        </div>
        <div className="row small muted">
          {present.length} here · {absent.size} away
        </div>
      </div>

      <div className="section-title">FORMAT</div>
      <div className="card">
        <div className="row">
          <span className="grow small">Six a side (adds a Mid)</span>
          <button className="btn-sm" onClick={() => setSixASide(slots.length === 5)}>
            {slots.length > 5 ? 'On' : 'Off'}
          </button>
        </div>
        <div className="row small muted" style={{ lineHeight: 1.5 }}>
          Half time is a button during the game, not a setting — tap it if it happens.
        </div>
      </div>

      <button
        className="btn-primary btn-block"
        style={{ marginTop: 16, minHeight: 64, fontSize: 18 }}
        disabled={!ready}
        onClick={start}
      >
        {ready ? 'Confirm line-up and go' : 'Fill every position to start'}
      </button>

      <button className="btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onLeave}>
        Leave for now — this is saved
      </button>
    </div>
  )
}
