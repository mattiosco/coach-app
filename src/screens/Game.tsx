import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MINUTE,
  currentClock,
  fairShares,
  totalMatchMs,
  type MatchState,
  type Share,
} from '../domain/engine'
import type { MatchEvent, NewMatchEvent } from '../domain/events'
import { msToNextShift, shiftNumber, suggestSubs } from '../domain/suggest'
import {
  DEFAULT_CONFIG,
  formationFor,
  type Availability,
  type PlayerId,
  type SlotId,
} from '../domain/types'
import { acquireWakeLock } from '../lib/platform'
import {
  activeMatch,
  dayContextFor,
  hasStarted,
  newMatch,
  stateOf,
  useSeason,
  type PlannedSub,
  type StoredMatch,
} from '../state/store'
import PitchMap from '../ui/PitchMap'
import Setup from './Setup'
import Summary from './Summary'

export default function Game({ onNoMatch }: { onNoMatch: () => void }) {
  const { season, dispatch } = useSeason()
  const match = activeMatch(season)

  if (!match) {
    const parked = season.matches.filter((m) => !m.endedAt)
    const played = [...season.matches]
      .filter((m) => m.endedAt)
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    return (
      <div className="screen">
        <h2 style={{ fontSize: 24 }}>No match running</h2>
        <p className="muted small" style={{ lineHeight: 1.5 }}>
          Pick a fixture, or start a practice match to have a play.
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
                match: newMatch(
                  null,
                  'Practice match',
                  {},
                  { ...DEFAULT_CONFIG, totalMinutes: season.defaults.gameMinutes },
                  formationFor(season.defaults.playersPerSide),
                ),
              })
            }
          >
            Start a practice match
          </button>
        </div>

        {parked.length > 0 && (
          <>
            <div className="section-title">SET UP EARLIER — PICK UP WHERE YOU LEFT OFF</div>
            <div className="stack">
              {parked.map((m) => (
                <div className="card" key={m.id}>
                  <div className="row">
                    <div className="grow">
                      <div style={{ fontWeight: 700 }}>{m.label}</div>
                      <div className="small muted">
                        {hasStarted(m) ? 'In progress' : 'Line-up saved, not started'}
                      </div>
                    </div>
                  </div>
                  <div className="row">
                    <button
                      className="btn-primary grow"
                      onClick={() => dispatch({ type: 'SET_ACTIVE', id: m.id })}
                    >
                      {hasStarted(m) ? 'Resume game' : 'Continue setting up'}
                    </button>
                    <button
                      className="btn-ghost btn-sm btn-danger"
                      onClick={() => {
                        if (!confirm(`Throw away "${m.label}"?`)) return
                        dispatch({ type: 'DELETE_MATCH', id: m.id })
                      }}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {played.length > 0 && (
          <>
            <div className="section-title">PLAYED — TIMES AND VOTES</div>
            <div className="stack">
              {played.map((m) => (
                <div className="card" key={m.id}>
                  <div className="row">
                    <div className="grow">
                      <div style={{ fontWeight: 700 }}>{m.label}</div>
                      <div className="small muted">
                        {m.endedAt ? new Date(m.endedAt).toLocaleDateString() : ''}
                      </div>
                    </div>
                    <button
                      className="btn-sm"
                      onClick={() => dispatch({ type: 'SET_ACTIVE', id: m.id })}
                    >
                      View
                    </button>
                    <button
                      className="btn-ghost btn-sm btn-danger"
                      onClick={() => {
                        if (!confirm(`Delete "${m.label}" for good? Its minutes stop counting.`))
                          return
                        dispatch({ type: 'DELETE_MATCH', id: m.id })
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {season.players.length < 2 && (
          <p className="muted small" style={{ marginTop: 12 }}>
            Add some players on the Squad tab first.
          </p>
        )}
      </div>
    )
  }

  const state = stateOf(season, match)
  const leave = () => dispatch({ type: 'SET_ACTIVE', id: null })

  if (match.endedAt) return <Summary match={match} onDone={leave} />

  return hasStarted(match) ? (
    <Live match={match} state={state} onLeave={leave} />
  ) : (
    <Setup match={match} onLeave={leave} />
  )
}

/** What the "just changed" panel holds: substitutions and positional moves alike. */
type RecentChange =
  | { kind: 'sub'; slotId: SlotId; off: PlayerId | null; on: PlayerId }
  | {
      kind: 'move'
      slotA: SlotId
      slotB: SlotId
      playerA: PlayerId | null
      playerB: PlayerId | null
    }

function Live({
  match,
  state,
  onLeave,
}: {
  match: StoredMatch
  state: MatchState
  onLeave: () => void
}) {
  const { season, dispatch } = useSeason()
  const [, tick] = useState(0)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [ackedShift, setAckedShift] = useState(0)
  /** Changes just made, kept on screen while everyone finds their new spot. */
  const [recent, setRecent] = useState<RecentChange[] | null>(null)
  const recentTimer = useRef<number | undefined>(undefined)
  const [suggestMsg, setSuggestMsg] = useState<string | null>(null)
  /** Moving players between positions, rather than subbing anyone on or off. */
  const [moving, setMoving] = useState(false)
  /** The match length we have already blown full time on, so Resume is not overridden. */
  const autoPausedAt = useRef<number | null>(null)

  const running = state.runningSince !== null
  const planned = match.plannedSubs

  // One timer drives the screen. The clock is always derived from Date.now(), so a
  // missed tick costs nothing.
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

  const clock = currentClock(state, Date.now())
  const totalMs = totalMatchMs(match.config)
  const day = useMemo(() => dayContextFor(season, match), [season, match])
  const shares = useMemo(
    () => fairShares(season.players, state, match.config, clock, day),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [season.players, state, match.config, day, Math.floor(clock / 1000)],
  )
  const shareOf = new Map(shares.map((s) => [s.playerId, s]))
  const nameOf = (id: PlayerId | null) => season.players.find((p) => p.id === id)?.name ?? '—'

  const append = (event: NewMatchEvent) =>
    dispatch({
      type: 'APPEND',
      id: match.id,
      event: { ...event, at: Date.now(), clock: currentClock(state, Date.now()) } as MatchEvent,
    })

  const shift = shiftNumber(clock, match.config.shiftMinutes)
  const shiftDue = running && shift > ackedShift && clock > 0

  const suggestions = useMemo(
    () => (shiftDue && planned.length === 0 ? suggestSubs(season.players, state, shares, clock) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shiftDue, state, shares, planned.length],
  )

  // Buzz once when a shift falls due, so it lands with the phone in a pocket.
  const buzzed = useRef(0)
  useEffect(() => {
    if (shiftDue && buzzed.current !== shift) {
      buzzed.current = shift
      navigator.vibrate?.([200, 100, 200])
    }
  }, [shiftDue, shift])

  /**
   * Stop the clock at full time on our own.
   *
   * The whistle goes and the phone is in a pocket; left alone the clock kept running and
   * every girl on the park quietly banked minutes she never played. The pause is stamped
   * at exactly full time rather than whenever this fires, so a late notice costs nothing.
   * Resuming is still allowed — we only ever do this once per match length, so adding
   * time and playing on works.
   */
  useEffect(() => {
    if (!running || clock < totalMs) return
    if (autoPausedAt.current === totalMs) return
    autoPausedAt.current = totalMs
    dispatch({
      type: 'APPEND',
      id: match.id,
      event: { t: 'CLOCK_PAUSE', at: Date.now(), clock: totalMs },
    })
    navigator.vibrate?.([300, 120, 300])
  }, [running, clock, totalMs, match.id, dispatch])

  const plannedBySlot = new Map(planned.map((p) => [p.slotId, p]))
  const plannedOn = new Set(planned.map((p) => p.on))

  const bench = season.players.filter(
    (p) => !Object.values(state.onField).includes(p.id) && state.availability[p.id] === 'available',
  )

  const setPlanned = (next: PlannedSub[]) =>
    dispatch({ type: 'PLAN_SUBS', id: match.id, planned: next })

  const showRecent = (changes: RecentChange[]) => {
    setRecent(changes)
    window.clearTimeout(recentTimer.current)
    recentTimer.current = window.setTimeout(() => setRecent(null), 60_000)
  }

  const startMoving = (slotId?: SlotId) => {
    setMoving(true)
    setSuggestMsg(null)
    setSelectedSlot(slotId ?? null)
  }

  /** Tapping a position selects it; tapping it again clears any plan on it. */
  const handleSlot = (slotId: string) => {
    if (moving) {
      // Two taps swap the girls standing in those spots. Nobody comes off, so no minutes
      // change hands — it is only the shape of the team that moves.
      if (!selectedSlot) {
        setSelectedSlot(slotId)
        return
      }
      if (selectedSlot === slotId) {
        setSelectedSlot(null)
        return
      }
      const playerA = state.onField[selectedSlot] ?? null
      const playerB = state.onField[slotId] ?? null
      append({ t: 'SWAP', slotA: selectedSlot, slotB: slotId })
      showRecent([{ kind: 'move', slotA: selectedSlot, slotB: slotId, playerA, playerB }])
      setSelectedSlot(null)
      navigator.vibrate?.(40)
      return
    }
    if (plannedBySlot.has(slotId) && selectedSlot === slotId) {
      setPlanned(planned.filter((p) => p.slotId !== slotId))
      setSelectedSlot(null)
      return
    }
    setSelectedSlot(selectedSlot === slotId ? null : slotId)
  }

  /** Tapping a bench player plans her into the selected position. */
  const handleBench = (playerId: PlayerId) => {
    if (moving || !selectedSlot) return
    const next = planned.filter((p) => p.slotId !== selectedSlot && p.on !== playerId)
    setPlanned([
      ...next,
      { slotId: selectedSlot, off: state.onField[selectedSlot] ?? null, on: playerId },
    ])
    setSelectedSlot(null)
  }

  const suggestNow = () => {
    const proposals = suggestSubs(season.players, state, shares, clock)
    if (proposals.length === 0) {
      setSuggestMsg(
        'Nothing to suggest right now — everyone is close to her share, or the last subs are still settling in.',
      )
      return
    }
    setSuggestMsg(null)
    setPlanned(proposals.map((p) => ({ slotId: p.slotId, off: p.off, on: p.on })))
    setSelectedSlot(null)
    setAckedShift(shift)
  }

  const makeSubs = () => {
    const at = Date.now()
    const stamp = currentClock(state, at)
    for (const sub of planned) {
      dispatch({
        type: 'APPEND',
        id: match.id,
        event: { t: 'SUB', slotId: sub.slotId, off: sub.off, on: sub.on, at, clock: stamp },
      })
    }
    // Hold the list up for a minute: the girls are still sorting themselves out, and
    // this is what you check them against.
    showRecent(planned.map((p) => ({ kind: 'sub', slotId: p.slotId, off: p.off, on: p.on })))

    setPlanned([])
    setAckedShift(shift)
    setSelectedSlot(null)
    navigator.vibrate?.(60)
  }

  // The moment the next change starts being planned, the last one is history.
  useEffect(() => {
    if (planned.length > 0) {
      setRecent(null)
      setSuggestMsg(null)
      window.clearTimeout(recentTimer.current)
    }
  }, [planned.length])

  useEffect(() => () => window.clearTimeout(recentTimer.current), [])

  const addMinutes = (extra: number) =>
    dispatch({
      type: 'SET_CONFIG',
      id: match.id,
      config: { ...match.config, totalMinutes: match.config.totalMinutes + extra },
    })

  const endMatch = () => {
    if (!confirm('End the match and save it?')) return
    append({ t: 'MATCH_END' })
    dispatch({ type: 'END_MATCH', id: match.id, at: Date.now() })
  }

  const outfieldCount = state.slots.filter((s) => !s.isGK).length

  return (
    <div className="screen">
      <div className="inline" style={{ justifyContent: 'space-between', gap: 8 }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {match.label}
          </div>
          {match.venue && (
            <div className="small" style={{ color: 'var(--amber)', fontWeight: 700 }}>
              {match.venue}
            </div>
          )}
        </div>
        <div className="small muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          Period {state.period} · shift {shift}
        </div>
      </div>

      {/* Sticky: both clocks stay readable however far down the screen you scroll. */}
      <div className="clockbar">
        <div className={`clock ${running ? 'running' : 'paused'}`}>{formatClock(clock)}</div>
        <div className="clockbar-side">
          <div>
            <span className="clockbar-num">
              {clock >= totalMs ? '0:00' : formatClock(totalMs - clock)}
            </span>
            <span className="clockbar-cap">left</span>
          </div>
          <div>
            <span className="clockbar-num" style={{ color: 'var(--amber)' }}>
              {formatClock(msToNextShift(clock, match.config.shiftMinutes))}
            </span>
            <span className="clockbar-cap">to sub</span>
          </div>
        </div>
      </div>

      <div className="inline" style={{ marginBottom: 12 }}>
        <button
          className={running ? '' : 'btn-primary'}
          style={{ flex: 2, minHeight: 60, fontSize: 18, fontWeight: 700 }}
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

      {clock >= totalMs && (
        <div className="stack" style={{ marginBottom: 12 }}>
          <div className="shift-banner">
            FULL TIME — {match.config.totalMinutes} min played, clock stopped
          </div>
          <div className="inline">
            <button className="grow" onClick={() => addMinutes(1)}>
              +1 min
            </button>
            <button className="grow" onClick={() => addMinutes(5)}>
              +5 min
            </button>
            <button className="btn-primary grow" onClick={endMatch}>
              End match
            </button>
          </div>
          <p className="muted small" style={{ margin: 0, lineHeight: 1.5 }}>
            Add time if it runs over, then press Resume.
          </p>
        </div>
      )}

      {shiftDue && planned.length === 0 && (
        <div className="stack" style={{ marginBottom: 12 }}>
          <div className="shift-banner">SUB DUE — shift {shift}</div>
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
                  onClick={() =>
                    setPlanned(
                      suggestions.map((s) => ({ slotId: s.slotId, off: s.off, on: s.on })),
                    )
                  }
                >
                  Plan these {suggestions.length}
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

      <PitchMap
        slots={state.slots}
        nameOf={nameOf}
        selectedSlotId={selectedSlot}
        fill={(slotId) => ({
          playerId: state.onField[slotId] ?? null,
          incoming: plannedBySlot.get(slotId)?.on ?? null,
        })}
        onSlotTap={handleSlot}
        onSlotHold={startMoving}
        shuffling={moving}
      />

      {planned.length === 0 && !moving && (
        <div className="inline" style={{ marginTop: 12 }}>
          <button className="grow" onClick={suggestNow}>
            Suggest subs
          </button>
          <button className="grow" onClick={() => startMoving()}>
            Move players
          </button>
        </div>
      )}

      {moving && (
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="shift-banner">
            {selectedSlot
              ? `MOVING ${(state.slots.find((s) => s.id === selectedSlot)?.label ?? '').toUpperCase()} — TAP WHERE SHE GOES`
              : 'MOVING PLAYERS — TAP TWO POSITIONS TO SWAP'}
          </div>
          <button
            className="btn-block"
            onClick={() => {
              setMoving(false)
              setSelectedSlot(null)
            }}
          >
            Done moving
          </button>
        </div>
      )}
      {suggestMsg && (
        <p className="muted small" style={{ margin: '8px 0 0', lineHeight: 1.5 }}>
          {suggestMsg}
        </p>
      )}

      {recent && recent.length > 0 && planned.length === 0 && (
        <div className="card" style={{ marginTop: 12, borderColor: 'var(--green-dim)' }}>
          <div className="row small muted">Just changed — check they are in the right spots</div>
          {recent.map((c) =>
            c.kind === 'sub' ? (
              <div className="row small" key={`sub-${c.slotId}`}>
                <span className="grow">
                  <strong style={{ color: 'var(--green)' }}>{nameOf(c.on)}</strong> on for{' '}
                  {nameOf(c.off)}
                </span>
                <span className="muted">{state.slots.find((x) => x.id === c.slotId)?.label}</span>
              </div>
            ) : (
              <div className="row small" key={`move-${c.slotA}-${c.slotB}`}>
                <span className="grow">
                  <strong style={{ color: 'var(--green)' }}>{nameOf(c.playerA)}</strong> and{' '}
                  <strong style={{ color: 'var(--green)' }}>{nameOf(c.playerB)}</strong> swapped
                </span>
                <span className="muted">
                  {state.slots.find((x) => x.id === c.slotA)?.label} /{' '}
                  {state.slots.find((x) => x.id === c.slotB)?.label}
                </span>
              </div>
            ),
          )}
          <div className="row">
            <button className="btn-ghost btn-sm btn-block" onClick={() => setRecent(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {planned.length > 0 && (
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="card">
            <div className="row small muted">
              Tell the girls, then make the change when play stops.
            </div>
            {planned.map((p) => (
              <div className="row small" key={p.slotId}>
                <span className="grow">
                  <strong style={{ color: 'var(--amber)' }}>{nameOf(p.on)}</strong> on for{' '}
                  {nameOf(p.off)}
                </span>
                <span className="muted">{state.slots.find((x) => x.id === p.slotId)?.label}</span>
              </div>
            ))}
          </div>
          <div className="inline">
            <button
              className="btn-primary grow"
              style={{ minHeight: 60, fontSize: 17, fontWeight: 700 }}
              onClick={makeSubs}
            >
              Make {planned.length === 1 ? 'this sub' : `these ${planned.length} subs`} now
            </button>
            <button className="btn-ghost" onClick={() => setPlanned([])}>
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="section-title">
        {moving
          ? 'BENCH — NOT USED WHILE MOVING'
          : selectedSlot
            ? `WHO GOES TO ${(state.slots.find((s) => s.id === selectedSlot)?.label ?? '').toUpperCase()}?`
            : 'BENCH — MOST OWED FIRST'}
      </div>
      <div className="bench-strip">
        {[...bench]
          .sort((a, b) => (shareOf.get(a.id)?.deltaMs ?? 0) - (shareOf.get(b.id)?.deltaMs ?? 0))
          .map((player) => {
            const share = shareOf.get(player.id)
            return (
              <button
                key={player.id}
                className={`bench-chip ${plannedOn.has(player.id) ? 'planned' : ''}`}
                disabled={moving || (!selectedSlot && !plannedOn.has(player.id))}
                style={{ opacity: selectedSlot || plannedOn.has(player.id) ? 1 : 0.85 }}
                onClick={() => handleBench(player.id)}
              >
                <span className="who">{player.name}</span>
                <span className="slot-label">
                  {plannedOn.has(player.id)
                    ? 'GOING ON'
                    : `${Math.round((share?.playedMs ?? 0) / MINUTE)} min`}
                </span>
                {share && <DeltaPill share={share} />}
              </button>
            )
          })}
        {bench.length === 0 && <p className="muted small">Nobody on the bench.</p>}
      </div>

      {!selectedSlot && planned.length === 0 && !moving && (
        <p className="muted small" style={{ marginTop: 10, lineHeight: 1.5 }}>
          Tap a position on the pitch, then tap who is going there. That plans the change
          so you can tell the girls — nothing moves until you tap Make subs. To rearrange
          the girls already on, tap Move players or hold down on a position.
        </p>
      )}

      <div className="section-title">
        {shares.some((s) => s.priorCreditMs > 0) ? 'TIME ON — TODAY INCLUDED' : 'TIME ON SO FAR'}
      </div>
      <div className="card">
        {[...shares]
          .filter((s) => state.availability[s.playerId] !== 'absent')
          .sort((a, b) => b.playedMs - a.playedMs)
          .map((s) => (
            <div className="row" key={s.playerId}>
              <span className="grow" style={{ fontWeight: s.onField ? 700 : 400 }}>
                {nameOf(s.playerId)}
                {s.onField && <span className="muted small"> · on</span>}
                {state.availability[s.playerId] === 'loaned' && (
                  <span className="muted small"> · lent out</span>
                )}
                {s.priorCreditMs > 0 && (
                  <div className="muted small">
                    {Math.round(s.priorCreditMs / MINUTE)} min earlier today
                  </div>
                )}
              </span>
              <span
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 700,
                  marginRight: 8,
                }}
              >
                {Math.round(s.playedMs / MINUTE)} min
              </span>
              <DeltaPill share={s} />
            </div>
          ))}
      </div>

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
                const usedIds = new Set(state.slots.map((s) => s.id))
                const usedLabels = new Set(state.slots.map((s) => s.label))
                let next = null
                for (let n = state.slots.length + 1; n <= 8 && !next; n++) {
                  next =
                    formationFor(n).find(
                      (slot) =>
                        !slot.isGK && !usedIds.has(slot.id) && !usedLabels.has(slot.label),
                    ) ?? null
                }
                next ??= { id: `slot-${crypto.randomUUID()}`, label: 'Extra', isGK: false }
                append({ t: 'SLOT_ADD', slot: next, playerId: null })
                // Open the picker straight away: adding a position is only ever the first
                // half of putting someone in it.
                setSelectedSlot(next.id)
                document.querySelector('.pitch')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
            >
              +
            </button>
          </div>
        </div>
        <div className="row">
          <span className="grow small">Game length</span>
          <div className="inline">
            <button
              className="btn-sm"
              disabled={match.config.totalMinutes <= 5}
              onClick={() =>
                dispatch({
                  type: 'SET_CONFIG',
                  id: match.id,
                  config: { ...match.config, totalMinutes: match.config.totalMinutes - 5 },
                })
              }
            >
              −
            </button>
            <strong style={{ minWidth: 52, textAlign: 'center' }}>
              {match.config.totalMinutes} min
            </strong>
            <button
              className="btn-sm"
              disabled={match.config.totalMinutes >= 60}
              onClick={() =>
                dispatch({
                  type: 'SET_CONFIG',
                  id: match.id,
                  config: { ...match.config, totalMinutes: match.config.totalMinutes + 5 },
                })
              }
            >
              +
            </button>
          </div>
        </div>
        <div className="row">
          <span className="grow small">Half time — swap ends</span>
          <button className="btn-sm" onClick={() => append({ t: 'PERIOD_END' })}>
            End period {state.period}
          </button>
        </div>
        {season.players.some((p) => state.availability[p.id] === 'absent') && (
          <>
            <div className="row">
              <span className="grow small">Turned up late? Tap her to add her in</span>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {season.players
                .filter((p) => state.availability[p.id] === 'absent')
                .map((player) => (
                  <button
                    key={player.id}
                    className="btn-sm"
                    style={{ borderColor: 'var(--green)' }}
                    onClick={() =>
                      append({
                        t: 'AVAILABILITY',
                        playerId: player.id,
                        status: 'available' as Availability,
                      })
                    }
                  >
                    {player.name} arrived
                  </button>
                ))}
            </div>
          </>
        )}

        <div className="row">
          <span className="grow small">Lend a player to the other team</span>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          {season.players
            .filter((p) => state.availability[p.id] !== 'absent')
            .map((player) => {
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
      </div>

      <div className="stack" style={{ marginTop: 12 }}>
        <button className="btn-ghost" onClick={onLeave}>
          Leave the game screen — this is saved
        </button>
        <button className="btn-ghost btn-danger" onClick={endMatch}>
          End match
        </button>
        <button
          className="btn-ghost btn-danger"
          onClick={() => {
            if (!confirm('Throw this match away? Nothing about it is kept.')) return
            dispatch({ type: 'DELETE_MATCH', id: match.id })
          }}
        >
          Discard — keep no record
        </button>
      </div>
    </div>
  )
}

function DeltaPill({ share }: { share: Share }) {
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
