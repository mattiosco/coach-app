import { useMemo, useState } from 'react'
import type { MatchEvent } from '../domain/events'
import { DEFAULT_SLOTS, MID_SLOT, type PlayerId, type Slot } from '../domain/types'
import { useSeason, type StoredMatch } from '../state/store'

/**
 * Pre-match. Who is here, who is in goal, and who starts. Kept on one screen because it
 * all happens in the two minutes before kick-off with a phone in one hand.
 */
export default function Setup({ match }: { match: StoredMatch }) {
  const { season, dispatch } = useSeason()
  const [absent, setAbsent] = useState<Set<PlayerId>>(new Set())
  const [gk, setGk] = useState<PlayerId | null>(null)
  const [assignments, setAssignments] = useState<Record<string, PlayerId | null>>({})
  const [sixASide, setSixASide] = useState(false)

  const slots: Slot[] = useMemo(
    () => (sixASide ? [...DEFAULT_SLOTS, MID_SLOT] : DEFAULT_SLOTS),
    [sixASide],
  )
  const outfieldSlots = slots.filter((s) => !s.isGK)

  const present = season.players.filter((p) => !absent.has(p.id))
  const outfieldPool = present.filter((p) => p.id !== gk)
  const taken = new Set(Object.values(assignments).filter(Boolean) as PlayerId[])

  const shareMinutes =
    outfieldPool.length > 0
      ? (match.config.totalMinutes * outfieldSlots.length) / outfieldPool.length
      : 0

  const ready = gk !== null && outfieldSlots.every((s) => assignments[s.id])

  const start = () => {
    if (!gk) return
    const full: Record<string, PlayerId | null> = { ...assignments }
    const keeper = slots.find((s) => s.isGK)
    if (keeper) full[keeper.id] = gk

    const availability = Object.fromEntries(
      season.players.map((p) => [p.id, absent.has(p.id) ? 'absent' : 'available'] as const),
    )

    dispatch({
      type: 'START_MATCH',
      match: { ...match, init: { slots, availability }, events: [] },
    })
    const event: MatchEvent = {
      t: 'LINEUP',
      at: Date.now(),
      clock: 0,
      slots,
      assignments: full,
    }
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

  return (
    <div className="screen">
      <h2 style={{ fontSize: 22, marginBottom: 2 }}>{match.label}</h2>
      <p className="muted small" style={{ margin: '0 0 8px' }}>
        {match.config.totalMinutes} min · sub every {match.config.shiftMinutes} min
      </p>

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
                  const next = new Set(absent)
                  if (here) {
                    next.add(player.id)
                    if (gk === player.id) setGk(null)
                    setAssignments((a) =>
                      Object.fromEntries(
                        Object.entries(a).map(([k, v]) => [k, v === player.id ? null : v]),
                      ),
                    )
                  } else {
                    next.delete(player.id)
                  }
                  setAbsent(next)
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
          <button className="btn-sm" onClick={() => setSixASide((v) => !v)}>
            {sixASide ? 'On' : 'Off'}
          </button>
        </div>
        <div className="row small muted" style={{ lineHeight: 1.5 }}>
          Half time is a button during the game, not a setting — tap it if it happens.
        </div>
      </div>

      <div className="section-title">KEEPER — ON ALL GAME</div>
      <div className="card">
        <div className="row wrap" style={{ gap: 6 }}>
          {present.map((player) => (
            <button
              key={player.id}
              className="btn-sm"
              style={{
                borderColor: gk === player.id ? 'var(--green)' : undefined,
                background: gk === player.id ? 'var(--green-dim)' : undefined,
              }}
              onClick={() => {
                setGk(gk === player.id ? null : player.id)
                setAssignments((a) =>
                  Object.fromEntries(
                    Object.entries(a).map(([k, v]) => [k, v === player.id ? null : v]),
                  ),
                )
              }}
            >
              {player.name}
            </button>
          ))}
        </div>
      </div>

      <div className="section-title">STARTING LINE-UP</div>
      <div className="stack">
        {outfieldSlots.map((slot) => (
          <div className="card" key={slot.id}>
            <div className="row">
              <span className="slot-label grow">{slot.label}</span>
              <strong>{nameOf(season.players, assignments[slot.id])}</strong>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {outfieldPool.map((player) => {
                const chosen = assignments[slot.id] === player.id
                const used = taken.has(player.id) && !chosen
                return (
                  <button
                    key={player.id}
                    className="btn-sm"
                    disabled={used}
                    style={{ borderColor: chosen ? 'var(--green)' : undefined }}
                    onClick={() =>
                      setAssignments((a) => ({ ...a, [slot.id]: chosen ? null : player.id }))
                    }
                  >
                    {player.name}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {outfieldPool.length > 0 && (
        <p className="muted small" style={{ marginTop: 14, lineHeight: 1.5 }}>
          Fair share this game is about <strong>{shareMinutes.toFixed(1)} minutes</strong> each
          across {outfieldPool.length} outfield players.
        </p>
      )}

      <button
        className="btn-primary btn-block"
        style={{ marginTop: 14, minHeight: 64, fontSize: 18 }}
        disabled={!ready}
        onClick={start}
      >
        {ready ? 'Confirm line-up' : 'Pick a keeper and a full line-up'}
      </button>
    </div>
  )
}

function nameOf(players: { id: string; name: string }[], id: PlayerId | null | undefined) {
  if (!id) return '—'
  return players.find((p) => p.id === id)?.name ?? '—'
}
