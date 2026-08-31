import { useState } from 'react'
import { hasStarted, matchForFixture, useSeason } from '../state/store'
import { fetchFixtures, isUpcoming, mergeFixtures } from '../lib/squadi'
import { DEFAULT_CONFIG, type Fixture } from '../domain/types'

const fmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

export default function Fixtures({ onPick }: { onPick: (fixture: Fixture) => void }) {
  const { season, dispatch } = useSeason()
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const sync = async () => {
    setSyncing(true)
    setError(null)
    try {
      const incoming = await fetchFixtures(season.squadiUrl)
      dispatch({
        type: 'SET_FIXTURES',
        fixtures: mergeFixtures(season.fixtures, incoming),
        syncedAt: Date.now(),
      })
    } catch (e) {
      setError(
        navigator.onLine
          ? `Could not sync: ${String(e instanceof Error ? e.message : e)}`
          : 'You are offline — showing the fixtures already saved.',
      )
    } finally {
      setSyncing(false)
    }
  }

  /** Fixtures already set up say so, so a saved line-up is never a surprise. */
  const labelFor = (fixtureId: string) => {
    const existing = matchForFixture(season, fixtureId)
    if (!existing) return 'Set up match'
    if (existing.endedAt) return 'Played — view'
    return hasStarted(existing) ? 'Resume game' : 'Continue setting up'
  }

  const upcoming = season.fixtures.filter((f) => isUpcoming(f))
  const past = season.fixtures.filter((f) => !isUpcoming(f))
  const shown = showPast ? season.fixtures : upcoming

  return (
    <div className="screen">
      <h2 style={{ fontSize: 24, marginBottom: 4 }}>Fixtures — {season.name}</h2>
      <p className="muted small" style={{ margin: '0 0 14px' }}>
        {season.fixturesSyncedAt
          ? `Synced ${new Date(season.fixturesSyncedAt).toLocaleString()}`
          : 'Not synced yet'}
      </p>

      <div className="inline wrap">
        <button onClick={() => void sync()} disabled={syncing || !season.squadiUrl}>
          {syncing ? 'Syncing…' : 'Sync from Squadi'}
        </button>
        <button
          className="btn-ghost"
          onClick={() =>
            dispatch({
              type: 'ADD_FIXTURE',
              fixture: {
                id: crypto.randomUUID(),
                round: 'Friendly',
                startTime: new Date().toISOString(),
                opponent: 'Opponent',
                homeAway: 'home',
                venue: 'Venue',
                source: 'manual',
                edited: true,
                config: DEFAULT_CONFIG,
              },
            })
          }
        >
          Add by hand
        </button>
        {!season.squadiUrl && (
          <span className="small muted">Set the Squadi link on the Team tab to sync.</span>
        )}
      </div>

      {error && (
        <p className="small" style={{ color: 'var(--amber)', lineHeight: 1.5 }}>
          {error}
        </p>
      )}

      <div className="stack" style={{ marginTop: 16 }}>
        {shown.map((fixture) =>
          editing === fixture.id ? (
            <FixtureEditor
              key={fixture.id}
              fixture={fixture}
              onDone={() => setEditing(null)}
              onRemove={() => {
                dispatch({ type: 'REMOVE_FIXTURE', id: fixture.id })
                setEditing(null)
              }}
              onChange={(patch) => dispatch({ type: 'EDIT_FIXTURE', id: fixture.id, patch })}
            />
          ) : (
            <div className="card" key={fixture.id}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="small muted">
                    {fixture.round} · {fixture.homeAway === 'home' ? 'Home' : 'Away'}
                    {fixture.edited && ' · edited'}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700, margin: '2px 0' }}>
                    v {fixture.opponent}
                  </div>
                  <div className="small muted">{fmt.format(new Date(fixture.startTime))}</div>
                  <div className="small muted">{fixture.venue}</div>
                </div>
              </div>
              <div className="row">
                <button className="btn-primary grow" onClick={() => onPick(fixture)}>
                  {labelFor(fixture.id)}
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setEditing(fixture.id)}>
                  Edit
                </button>
              </div>
            </div>
          ),
        )}
      </div>

      {shown.length === 0 && (
        <p className="muted small" style={{ marginTop: 20, lineHeight: 1.5 }}>
          No fixtures yet. Set this team&apos;s Squadi link and sync while you have signal, or
          add one by hand.
        </p>
      )}

      {past.length > 0 && (
        <button
          className="btn-ghost btn-block"
          style={{ marginTop: 16 }}
          onClick={() => setShowPast((v) => !v)}
        >
          {showPast ? 'Hide past fixtures' : `Show ${past.length} past fixtures`}
        </button>
      )}
    </div>
  )
}

/** Squadi is sometimes wrong, so every field is editable and the edit sticks. */
function FixtureEditor({
  fixture,
  onChange,
  onDone,
  onRemove,
}: {
  fixture: Fixture
  onChange: (patch: Partial<Fixture>) => void
  onDone: () => void
  onRemove: () => void
}) {
  const local = toLocalInput(fixture.startTime)

  return (
    <div className="card">
      <div className="row stack" style={{ alignItems: 'stretch' }}>
        <label className="small muted">Opponent</label>
        <input
          type="text"
          value={fixture.opponent}
          onChange={(e) => onChange({ opponent: e.target.value })}
        />

        <label className="small muted">Kick-off</label>
        <input
          type="datetime-local"
          value={local}
          onChange={(e) => onChange({ startTime: fromLocalInput(e.target.value) })}
        />

        <label className="small muted">Venue</label>
        <input
          type="text"
          value={fixture.venue}
          onChange={(e) => onChange({ venue: e.target.value })}
        />

        <label className="small muted">Round</label>
        <input
          type="text"
          value={fixture.round}
          onChange={(e) => onChange({ round: e.target.value })}
        />

        <label className="small muted">Home or away</label>
        <select
          value={fixture.homeAway}
          onChange={(e) => onChange({ homeAway: e.target.value as 'home' | 'away' })}
        >
          <option value="home">Home</option>
          <option value="away">Away</option>
        </select>
      </div>
      <div className="row">
        <button className="btn-primary grow" onClick={onDone}>
          Done
        </button>
        <button className="btn-ghost btn-sm btn-danger" onClick={onRemove}>
          Delete
        </button>
      </div>
    </div>
  )
}

/** datetime-local wants local wall time with no zone, so convert around the offset. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const offset = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - offset).toISOString().slice(0, 16)
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString()
}
