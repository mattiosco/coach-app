import { useMemo } from 'react'
import {
  MINUTE,
  currentClock,
  fairShares,
  foldMatch,
  goalMsFor,
  loanMsFor,
  minutesPlayedMs,
} from '../domain/engine'
import type { PlayerId } from '../domain/types'
import { dayContextFor, stateOf, useSeason, type StoredMatch, type Votes } from '../state/store'

const VOTE_SLOTS: { key: keyof Votes; points: number; label: string }[] = [
  { key: 'first', points: 3, label: '3 votes' },
  { key: 'second', points: 2, label: '2 votes' },
  { key: 'third', points: 1, label: '1 vote' },
]

/**
 * What actually happened: minutes each girl had, how that sits against a fair share, and
 * the same again across the whole match day. Then a private 3-2-1, for the coach only.
 */
export default function Summary({ match, onDone }: { match: StoredMatch; onDone: () => void }) {
  const { season, dispatch } = useSeason()

  const state = stateOf(season, match)
  const clock = currentClock(state, Date.now())
  const day = useMemo(() => dayContextFor(season, match), [season, match])
  const shares = fairShares(season.players, state, match.config, clock, day)

  const rows = shares
    .map((share) => ({
      ...share,
      name: season.players.find((p) => p.id === share.playerId)?.name ?? '—',
      loanMs: loanMsFor(state, share.playerId, clock),
      goalMs: goalMsFor(state, share.playerId, clock),
      started: state.starters.includes(share.playerId),
    }))
    .sort((a, b) => b.playedMs - a.playedMs)

  // The day's other games, so two matches on one Friday read as one outing.
  const dayMatches = season.matches.filter((m) => m.dayKey === match.dayKey)
  const dayRows = season.players
    .map((player) => {
      const total = dayMatches.reduce((sum, m) => {
        const s = foldMatch(season.players, m.init, m.events)
        return sum + minutesPlayedMs(s, player.id, currentClock(s, Date.now()))
      }, 0)
      return { id: player.id, name: player.name, totalMs: total }
    })
    .sort((a, b) => b.totalMs - a.totalMs)

  const setVote = (key: keyof Votes, playerId: PlayerId) => {
    const votes: Votes = { ...match.votes }
    // One girl cannot take two places, so clear her from any other slot first.
    for (const slot of VOTE_SLOTS) if (votes[slot.key] === playerId) delete votes[slot.key]
    votes[key] = votes[key] === playerId ? undefined : playerId
    dispatch({ type: 'SET_VOTES', id: match.id, votes })
  }

  return (
    <div className="screen">
      <h2 style={{ fontSize: 20, marginBottom: 2 }}>{match.label}</h2>
      <p className="muted small" style={{ margin: '0 0 16px' }}>
        {match.endedAt ? `Full time · ${formatMins(clock)} played` : 'In progress'}
        {match.venue ? ` · ${match.venue}` : ''}
      </p>

      <div className="section-title">TIME ON THIS GAME</div>
      <div className="card">
        {rows.map((row) => (
          <div className="row" key={row.playerId}>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>
                {row.name}
                {row.started && <span className="muted small"> · started</span>}
              </div>
              <div className="muted small">{describe(row.goalMs, row.loanMs)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {formatMins(row.playedMs)}
              </div>
              <Delta deltaMs={row.deltaMs} />
            </div>
          </div>
        ))}
      </div>
      <p className="muted small" style={{ margin: '8px 0 0', lineHeight: 1.5 }}>
        The number under each time is minutes above or below a fair share. Time in goal
        counts as half, since it is half the running.
      </p>

      {dayMatches.length > 1 && (
        <>
          <div className="section-title">
            THE WHOLE DAY — {dayMatches.length} GAMES
          </div>
          <div className="card">
            {dayRows.map((row) => (
              <div className="row" key={row.id}>
                <span className="grow">{row.name}</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatMins(row.totalMs)}
                </strong>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title">YOUR 3-2-1 — PRIVATE</div>
      <div className="stack">
        {VOTE_SLOTS.map((slot) => (
          <div className="card" key={slot.key}>
            <div className="row">
              <span className="slot-label grow">{slot.label}</span>
              <strong>
                {match.votes[slot.key]
                  ? (season.players.find((p) => p.id === match.votes[slot.key])?.name ?? '—')
                  : 'nobody yet'}
              </strong>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {season.players.map((player) => (
                <button
                  key={player.id}
                  className="btn-sm"
                  style={{
                    borderColor:
                      match.votes[slot.key] === player.id ? 'var(--green)' : undefined,
                  }}
                  onClick={() => setVote(slot.key, player.id)}
                >
                  {player.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="muted small" style={{ margin: '8px 0 0', lineHeight: 1.5 }}>
        Never shown to the girls or the parents. Skip it if you would rather not.
      </p>

      <button className="btn-primary btn-block" style={{ marginTop: 18 }} onClick={onDone}>
        Done
      </button>

      <button
        className="btn-ghost btn-block btn-danger"
        style={{ marginTop: 10 }}
        onClick={() => {
          if (!confirm(`Delete "${match.label}" for good? Its minutes stop counting.`)) return
          dispatch({ type: 'DELETE_MATCH', id: match.id })
        }}
      >
        Delete this match
      </button>
      <p className="muted small" style={{ margin: '8px 0 0', lineHeight: 1.5 }}>
        Deleting takes these minutes out of the day, so a practice run does not count
        toward the real games.
      </p>
    </div>
  )
}

function describe(goalMs: number, loanMs: number): string {
  const parts: string[] = []
  if (goalMs > 0) parts.push(`${formatMins(goalMs)} in goal`)
  if (loanMs > 0) parts.push(`${formatMins(loanMs)} lent out`)
  return parts.join(' · ') || 'outfield'
}

function Delta({ deltaMs }: { deltaMs: number }) {
  const rounded = Math.round((deltaMs / MINUTE) * 10) / 10
  const cls = Math.abs(rounded) < 0.5 ? 'level' : rounded < 0 ? 'behind' : 'ahead'
  return (
    <span className={`pill ${cls}`}>
      {rounded > 0 ? '+' : ''}
      {rounded.toFixed(1)}
    </span>
  )
}

function formatMins(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
