import { useState } from 'react'
import { FORMATION_NAMES, ROLES } from '../domain/types'
import { useSeason } from '../state/store'
import { parseSquadiUrl } from '../lib/squadi'

export default function Squad() {
  const { app, season, dispatch } = useSeason()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [linkDraft, setLinkDraft] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)

  const setDefaults = (patch: Partial<typeof season.defaults>) =>
    dispatch({ type: 'SET_TEAM_DEFAULTS', defaults: { ...season.defaults, ...patch } })

  const saveLink = () => {
    const url = (linkDraft ?? season.squadiUrl).trim()
    if (url) {
      try {
        parseSquadiUrl(url)
      } catch (e) {
        setLinkError(String(e instanceof Error ? e.message : e))
        return
      }
    }
    dispatch({ type: 'SET_SQUADI_URL', url })
    setLinkError(null)
    setLinkDraft(null)
  }

  const add = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    dispatch({ type: 'ADD_PLAYER', name: trimmed })
    setName('')
  }

  return (
    <div className="screen">
      <h2 style={{ fontSize: 24, marginBottom: 4 }}>Teams</h2>
      <div className="row wrap" style={{ gap: 6, padding: 0, border: 0, marginBottom: 8 }}>
        {app.teams.map((team) => (
          <button
            key={team.id}
            className="btn-sm"
            style={{
              borderColor: team.id === season.id ? 'var(--green)' : undefined,
              background: team.id === season.id ? 'var(--green-dim)' : undefined,
            }}
            onClick={() => dispatch({ type: 'TEAM_SELECT', id: team.id })}
          >
            {team.name}
          </button>
        ))}
        <button
          className="btn-sm btn-ghost"
          onClick={() => {
            const teamName = prompt('Name for the new team?')
            if (teamName?.trim()) dispatch({ type: 'TEAM_ADD', name: teamName })
          }}
        >
          + Add team
        </button>
      </div>
      <div className="inline wrap" style={{ marginBottom: 16 }}>
        <button
          className="btn-sm btn-ghost"
          onClick={() => {
            const next = prompt('Rename this team', season.name)
            if (next?.trim()) dispatch({ type: 'TEAM_RENAME', id: season.id, name: next })
          }}
        >
          Rename {season.name}
        </button>
        {app.teams.length > 1 && (
          <button
            className="btn-sm btn-ghost btn-danger"
            onClick={() => {
              if (
                confirm(
                  `Delete the team "${season.name}" and everything in it — squad, fixtures, matches, votes?`,
                )
              )
                dispatch({ type: 'TEAM_DELETE', id: season.id })
            }}
          >
            Delete team
          </button>
        )}
      </div>

      <div className="section-title">{season.name.toUpperCase()} — SETTINGS</div>
      <div className="card">
        <div className="row">
          <span className="grow small">
            Default players per side · {FORMATION_NAMES[season.defaults.playersPerSide] ?? ''}
          </span>
          <div className="inline">
            <button
              className="btn-sm"
              disabled={season.defaults.playersPerSide <= 4}
              onClick={() => setDefaults({ playersPerSide: season.defaults.playersPerSide - 1 })}
            >
              −
            </button>
            <strong style={{ minWidth: 28, textAlign: 'center' }}>
              {season.defaults.playersPerSide}
            </strong>
            <button
              className="btn-sm"
              disabled={season.defaults.playersPerSide >= 8}
              onClick={() => setDefaults({ playersPerSide: season.defaults.playersPerSide + 1 })}
            >
              +
            </button>
          </div>
        </div>
        <div className="row">
          <span className="grow small">Default game length</span>
          <div className="inline">
            <button
              className="btn-sm"
              disabled={season.defaults.gameMinutes <= 5}
              onClick={() => setDefaults({ gameMinutes: season.defaults.gameMinutes - 5 })}
            >
              −
            </button>
            <strong style={{ minWidth: 52, textAlign: 'center' }}>
              {season.defaults.gameMinutes} min
            </strong>
            <button
              className="btn-sm"
              disabled={season.defaults.gameMinutes >= 60}
              onClick={() => setDefaults({ gameMinutes: season.defaults.gameMinutes + 5 })}
            >
              +
            </button>
          </div>
        </div>
        <div className="row stack" style={{ alignItems: 'stretch' }}>
          <label className="small muted">
            Squadi draw link — open the draw with your team selected and copy the address
          </label>
          <input
            type="text"
            value={linkDraft ?? season.squadiUrl}
            placeholder="https://registration.squadi.com/competitions?…&teamId=…"
            onChange={(e) => setLinkDraft(e.target.value)}
          />
          {linkDraft !== null && (
            <div className="inline">
              <button className="btn-primary btn-sm grow" onClick={saveLink}>
                Save link
              </button>
              <button className="btn-ghost btn-sm" onClick={() => { setLinkDraft(null); setLinkError(null) }}>
                Cancel
              </button>
            </div>
          )}
          {linkError && (
            <span className="small" style={{ color: 'var(--amber)' }}>{linkError}</span>
          )}
        </div>
        <div className="row small muted" style={{ lineHeight: 1.5 }}>
          Defaults apply to each new game; both can still be changed per game at setup and
          mid-game.
        </div>
      </div>

      <h2 style={{ fontSize: 20, margin: '18px 0 4px' }}>{season.name} squad</h2>
      <p className="muted small" style={{ margin: '0 0 16px' }}>
        {season.players.length} {season.players.length === 1 ? 'player' : 'players'}. Names stay
        on this phone. Tap a player to set where she likes to play.
      </p>

      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input
          type="text"
          value={name}
          placeholder="Add a player"
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={!name.trim()}>
          Add
        </button>
      </form>

      {season.players.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          {season.players.map((player) => (
            <div key={player.id}>
              <div className="row">
                {editing === player.id ? (
                  <input
                    type="text"
                    defaultValue={player.name}
                    autoFocus
                    onBlur={(e) => {
                      if (e.target.value.trim()) {
                        dispatch({ type: 'RENAME_PLAYER', id: player.id, name: e.target.value })
                      }
                      setEditing(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                  />
                ) : (
                  <>
                    <button
                      className="btn-ghost grow"
                      style={{ border: 0, textAlign: 'left', padding: 0, minHeight: 32 }}
                      onClick={() => setExpanded(expanded === player.id ? null : player.id)}
                    >
                      <div style={{ fontWeight: 600 }}>{player.name}</div>
                      {player.preferred && player.preferred.length > 0 && (
                        <div className="muted small">likes {player.preferred.join(', ')}</div>
                      )}
                    </button>
                    <button className="btn-ghost btn-sm" onClick={() => setEditing(player.id)}>
                      Rename
                    </button>
                    <button
                      className="btn-ghost btn-sm btn-danger"
                      onClick={() => {
                        if (confirm(`Remove ${player.name} from the squad?`)) {
                          dispatch({ type: 'REMOVE_PLAYER', id: player.id })
                        }
                      }}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
              {expanded === player.id && (
                <div className="row wrap" style={{ gap: 6 }}>
                  <span className="muted small" style={{ width: '100%' }}>
                    Preferred spots — optional, used to order suggestions
                  </span>
                  {ROLES.map((role) => {
                    const on = player.preferred?.includes(role) ?? false
                    return (
                      <button
                        key={role}
                        className="btn-sm"
                        style={{
                          borderColor: on ? 'var(--green)' : undefined,
                          background: on ? 'var(--green-dim)' : undefined,
                        }}
                        onClick={() =>
                          dispatch({
                            type: 'SET_PREFERRED',
                            id: player.id,
                            preferred: on
                              ? (player.preferred ?? []).filter((r) => r !== role)
                              : [...(player.preferred ?? []), role],
                          })
                        }
                      >
                        {role}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {season.players.length === 0 && (
        <p className="muted small" style={{ marginTop: 20, lineHeight: 1.5 }}>
          Add the girls one at a time, or import a team another coach shared with you from
          the Check tab.
        </p>
      )}
    </div>
  )
}
