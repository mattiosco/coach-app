import { useState } from 'react'
import { useSeason } from '../state/store'

export default function Squad() {
  const { season, dispatch } = useSeason()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  const add = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    dispatch({ type: 'ADD_PLAYER', name: trimmed })
    setName('')
  }

  return (
    <div className="screen">
      <h2 style={{ fontSize: 24, marginBottom: 4 }}>Squad</h2>
      <p className="muted small" style={{ margin: '0 0 16px' }}>
        {season.players.length} {season.players.length === 1 ? 'player' : 'players'}. Names stay
        on this phone.
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
            <div className="row" key={player.id}>
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
                    onClick={() => setEditing(player.id)}
                  >
                    {player.name}
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
          ))}
        </div>
      )}

      {season.players.length === 0 && (
        <p className="muted small" style={{ marginTop: 20, lineHeight: 1.5 }}>
          Add the girls one at a time. Tap a name later to fix a spelling.
        </p>
      )}
    </div>
  )
}
