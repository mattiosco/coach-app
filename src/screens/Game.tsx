import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MINUTE,
  currentClock,
  fairShares,
  goalkeeperId,
  totalMatchMs,
  type MatchState,
  type Share,
} from '../domain/engine'
import type { MatchEvent, NewMatchEvent } from '../domain/events'
import { msToNextShift, shiftNumber, suggestSubs } from '../domain/suggest'
import { DEFAULT_CONFIG, MID_SLOT, type Availability, type PlayerId } from '../domain/types'
import { acquireWakeLock } from '../lib/platform'
import { activeMatch, newMatch, stateOf, useSeason, type StoredMatch } from '../state/store'
import Setup from './Setup'

export default function Game({ onNoMatch }: { onNoMatch: () => void }) {
  const { season, dispatch } = useSeason()
  const match = activeMatch(season)

  if (!match) {
    return (
      <div className="screen">
        <h2 style={{ fontSize: 24 }}>No match running</h2>
        <p className="muted small" style={{ lineHeight: 1.5 }}>
          Pick a real fixture, or start a practice match to have a play. A practice match
          works exactly like a real one — it is just not tied to a fixture.
        </p>
        <div className="stack">
          <button className="btn-primary btn-block" onClick={onNoMatch}>
            Go to fixtures
          </button>
          <button
            className="btn-block"
            disabled={season.players.length < 2}
            onClick={() =>
              dispatch({
                type: 'START_MATCH',
                match: newMatch(null, 'Practice match', {}, DEFAULT_CONFIG),
              })
            }
          >
            Start a practice match
          </button>
        </div>
        {season.players.length < 2 && (
          <p className="muted small" style={{ marginTop: 12 }}>
            Add some players on the Squad tab first.
          </p>
        )}
      </div>
    )
  }

  const state = stateOf(season, match)
  const started = match.events.some((e) => e.t === 'LINEUP')

  return started ? <Live match={match} state={state} /> : <Setup match={match} />
}

type Selection =
  | { kind: 'bench'; playerId: PlayerId }
  | { kind: 'slot'; slotId: string }
  | null

function Live({ match, state }: { match: StoredMatch; state: MatchState }) {
  const { season, dispatch } = useSeason()
  const [, tick] = useState(0)
  const [selected, setSelected] = useState<Selection>(null)
  const [ackedShift, setAckedShift] = useState(0)

  const running = state.runningSince !== null

  // One timer drives the whole screen. The clock value itself is always derived from
  // Date.now(), so a missed tick costs nothing.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [running])

  // Keep the screen awake while the game is on, and let it sleep when paused.
  useEffect(() => {
    if (!running) return
    let release: (() => void) | null = null
    let cancelled = false
    void acquireWakeLock().then((r) => {
      if (cancelled) r?.()
      else release = r
    })
    return () => {
      cancelled = true
      release?.()
    }
  }, [running])

  const now = Date.now()
  const clock = currentClock(state, now)
  const totalMs = totalMatchMs(match.config)
  const shares = useMemo(
    () => fairShares(season.players, state, match.config, clock),
    // Recompute each tick: cheap, and always in step with the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [season.players, state, match.config, Math.floor(clock / 1000)],
  )
  const shareOf = new Map(shares.map((s) => [s.playerId, s]))
  const nameOf = (id: PlayerId | null) =>
    season.players.find((p) => p.id === id)?.name ?? '—'

  const append = (event: NewMatchEvent) =>
    dispatch({
      type: 'APPEND',
      id: match.id,
      event: { ...event, at: Date.now(), clock: currentClock(state, Date.now()) } as MatchEvent,
    })

  const shift = shiftNumber(clock, match.config.shiftMinutes)
  const shiftDue = running && shift > ackedShift && clock > 0
  const gk = goalkeeperId(state)

  const suggestions = useMemo(
    () => (shiftDue ? suggestSubs(season.players, state, shares, clock) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shiftDue, state, shares],
  )

  // Buzz once when a shift falls due, so it works with the phone in a pocket.
  const buzzed = useRef(0)
  useEffect(() => {
    if (shiftDue && buzzed.current !== shift) {
      buzzed.current = shift
      navigator.vibrate?.([200, 100, 200])
    }
  }, [shiftDue, shift])

  const bench = season.players.filter(
    (p) => !Object.values(state.onField).includes(p.id) && state.availability[p.id] === 'available',
  )

  const handleSlot = (slotId: string) => {
    const occupant = state.onField[slotId] ?? null
    if (!selected) {
      // Selecting an empty slot is useful too: it is how you fill a gap left by a loan.
      setSelected({ kind: 'slot', slotId })
      return
    }
    if (selected.kind === 'bench') {
      append({ t: 'SUB', slotId, off: occupant, on: selected.playerId })
      setSelected(null)
      return
    }
    if (selected.slotId === slotId) {
      setSelected(null)
      return
    }
    append({ t: 'SWAP', slotA: selected.slotId, slotB: slotId })
    setSelected(null)
  }

  const handleBench = (playerId: PlayerId) => {
    if (selected?.kind === 'slot') {
      append({ t: 'SUB', slotId: selected.slotId, off: state.onField[selected.slotId] ?? null, on: playerId })
      setSelected(null)
      return
    }
    setSelected(
      selected?.kind === 'bench' && selected.playerId === playerId
        ? null
        : { kind: 'bench', playerId },
    )
  }

  const outfieldCount = state.slots.filter((s) => !s.isGK).length

  return (
    <div className="screen">
      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <div className="small muted">{match.label}</div>
        <div className="small muted">
          Period {state.period} · shift {shift}
        </div>
      </div>

      <div className={`clock ${running ? 'running' : 'paused'}`} style={{ margin: '10px 0 2px' }}>
        {formatClock(clock)}
      </div>
      <div className="small muted" style={{ textAlign: 'center', marginBottom: 12 }}>
        {clock >= totalMs
          ? 'Full time reached'
          : `${formatClock(totalMs - clock)} left · next sub in ${formatClock(
              msToNextShift(clock, match.config.shiftMinutes),
            )}`}
      </div>

      <div className="inline" style={{ marginBottom: 12 }}>
        <button
          className={running ? '' : 'btn-primary'}
          style={{ flex: 2, minHeight: 64, fontSize: 18, fontWeight: 700 }}
          onClick={() => append({ t: running ? 'CLOCK_PAUSE' : 'CLOCK_START' })}
        >
          {running ? 'Pause' : clock === 0 ? 'Start' : 'Resume'}
        </button>
        <button
          className="btn-ghost"
          style={{ flex: 1 }}
          disabled={match.events.length === 0}
          onClick={() => dispatch({ type: 'UNDO', id: match.id, now: Date.now() })}
        >
          Undo
        </button>
      </div>

      {shiftDue && (
        <div className="stack" style={{ marginBottom: 12 }}>
          <div className="shift-banner">SUB NOW — shift {shift}</div>
          {suggestions.length > 0 && (
            <div className="card">
              {suggestions.map((s) => (
                <div className="row small" key={s.slotId}>
                  <span className="grow">
                    <strong>{nameOf(s.on)}</strong> on for {nameOf(s.off)}
                  </span>
                  <span className="muted">{state.slots.find((x) => x.id === s.slotId)?.label}</span>
                </div>
              ))}
              <div className="row">
                <button
                  className="btn-primary grow"
                  onClick={() => {
                    for (const s of suggestions) {
                      dispatch({
                        type: 'APPEND',
                        id: match.id,
                        event: {
                          t: 'SUB',
                          slotId: s.slotId,
                          off: s.off,
                          on: s.on,
                          at: Date.now(),
                          clock: currentClock(state, Date.now()),
                        },
                      })
                    }
                    setAckedShift(shift)
                    setSelected(null)
                  }}
                >
                  Apply {suggestions.length} {suggestions.length === 1 ? 'change' : 'changes'}
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setAckedShift(shift)}>
                  Skip
                </button>
              </div>
            </div>
          )}
          {suggestions.length === 0 && (
            <button className="btn-ghost btn-block" onClick={() => setAckedShift(shift)}>
              Nothing to change — dismiss
            </button>
          )}
        </div>
      )}

      <div className="section-title">ON THE PARK</div>
      <div className="stack">
        {state.slots.map((slot) => {
          const occupant = state.onField[slot.id] ?? null
          const share = occupant ? shareOf.get(occupant) : undefined
          return (
            <button
              key={slot.id}
              className={[
                'slot',
                slot.isGK ? 'gk' : '',
                occupant ? '' : 'empty',
                selected?.kind === 'slot' && selected.slotId === slot.id ? 'selected' : '',
              ].join(' ')}
              onClick={() => handleSlot(slot.id)}
            >
              <div className="grow">
                <div className="slot-label">
                  {slot.label}
                  {slot.isGK && ' · all game'}
                </div>
                <div className="slot-name">{occupant ? nameOf(occupant) : 'Empty'}</div>
              </div>
              {share && <DeltaPill share={share} isGK={slot.isGK} />}
            </button>
          )
        })}
      </div>

      <div className="section-title">BENCH — MOST RESTED FIRST</div>
      <div className="stack">
        {[...bench]
          .sort((a, b) => (shareOf.get(a.id)?.deltaMs ?? 0) - (shareOf.get(b.id)?.deltaMs ?? 0))
          .map((player) => {
            const share = shareOf.get(player.id)
            return (
              <button
                key={player.id}
                className={[
                  'slot',
                  selected?.kind === 'bench' && selected.playerId === player.id ? 'selected' : '',
                ].join(' ')}
                onClick={() => handleBench(player.id)}
              >
                <div className="grow">
                  <div className="slot-name">{player.name}</div>
                  <div className="slot-label">
                    {share ? `${Math.round(share.playedMs / MINUTE)} min played` : ''}
                  </div>
                </div>
                {share && <DeltaPill share={share} isGK={player.id === gk} />}
              </button>
            )
          })}
        {bench.length === 0 && <p className="muted small">Nobody on the bench.</p>}
      </div>

      {selected && (
        <p className="small" style={{ color: 'var(--amber)', marginTop: 12 }}>
          {selected.kind === 'bench'
            ? `${nameOf(selected.playerId)} selected — tap a position to bring her on.`
            : 'Position selected — tap a bench player to sub, or another position to swap.'}
        </p>
      )}

      <div className="section-title">GAME</div>
      <div className="card">
        <div className="row">
          <span className="grow small">Players on the park</span>
          <div className="inline">
            <button
              className="btn-sm"
              disabled={outfieldCount <= 1}
              onClick={() => {
                const last = [...state.slots].reverse().find((s) => !s.isGK)
                if (last) append({ t: 'SLOT_REMOVE', slotId: last.id })
              }}
            >
              −
            </button>
            <strong style={{ minWidth: 28, textAlign: 'center' }}>{state.slots.length}</strong>
            <button
              className="btn-sm"
              onClick={() => {
                const used = new Set(state.slots.map((s) => s.id))
                const next = !used.has(MID_SLOT.id)
                  ? MID_SLOT
                  : { id: `slot-${state.slots.length}`, label: 'Extra', isGK: false }
                append({ t: 'SLOT_ADD', slot: next, playerId: null })
              }}
            >
              +
            </button>
          </div>
        </div>
        <div className="row">
          <span className="grow small">Half time — swap ends</span>
          <button
            className="btn-sm"
            onClick={() => {
              append({ t: 'PERIOD_END' })
              setSelected(null)
            }}
          >
            End period {state.period}
          </button>
        </div>
        <div className="row">
          <span className="grow small">Lend a player to the other team</span>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          {season.players.map((player) => {
            const status = state.availability[player.id]
            return (
              <button
                key={player.id}
                className="btn-sm"
                style={{
                  borderColor: status === 'loaned' ? 'var(--amber)' : undefined,
                  color: status === 'loaned' ? 'var(--amber)' : undefined,
                }}
                onClick={() =>
                  append({
                    t: 'AVAILABILITY',
                    playerId: player.id,
                    status: (status === 'loaned' ? 'available' : 'loaned') as Availability,
                  })
                }
              >
                {player.name}
                {status === 'loaned' && ' ↩'}
              </button>
            )
          })}
        </div>
        <div className="row">
          <button
            className="btn-ghost btn-danger btn-block"
            onClick={() => {
              if (!confirm('End the match and save it?')) return
              append({ t: 'MATCH_END' })
              dispatch({ type: 'END_MATCH', id: match.id, at: Date.now() })
            }}
          >
            End match
          </button>
        </div>
        <div className="row">
          <button
            className="btn-ghost btn-danger btn-block"
            onClick={() => {
              if (!confirm('Throw this match away? Nothing about it is kept.')) return
              dispatch({ type: 'DELETE_MATCH', id: match.id })
            }}
          >
            Discard — keep no record
          </button>
        </div>
      </div>
    </div>
  )
}

function DeltaPill({ share, isGK }: { share: Share; isGK: boolean }) {
  if (isGK) return <span className="pill level">GK</span>
  const deltaMin = share.deltaMs / MINUTE
  const rounded = Math.round(deltaMin * 10) / 10
  const cls = Math.abs(rounded) < 0.5 ? 'level' : rounded < 0 ? 'behind' : 'ahead'
  return (
    <span className={`pill ${cls}`}>
      {rounded > 0 ? '+' : ''}
      {rounded.toFixed(1)}
    </span>
  )
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
