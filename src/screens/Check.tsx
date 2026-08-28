import { useEffect, useState } from 'react'
import {
  probeCapabilities,
  isInstalled,
  serviceWorkerStatus,
  type Capability,
  type ServiceWorkerStatus,
} from '../lib/platform'
import { requestPersistence, estimateUsage, store } from '../lib/storage'
import { useSeason } from '../state/store'

const BUILD = __BUILD_TIME__

const SW_LABEL: Record<ServiceWorkerStatus, string> = {
  unsupported: 'not supported',
  none: 'not registered',
  registered: 'registered, not yet active',
  controlling: 'yes — serving from cache',
}

export default function Check() {
  const { season, dispatch } = useSeason()
  const [caps] = useState<Capability[]>(probeCapabilities)
  const [online, setOnline] = useState(navigator.onLine)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<string | null>(null)
  const [roundTrip, setRoundTrip] = useState<string>('checking…')
  const [sw, setSw] = useState<ServiceWorkerStatus | null>(null)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  useEffect(() => {
    // The worker often takes control a moment after first paint, so re-check until it does.
    const tick = () => void serviceWorkerStatus().then(setSw)
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    void (async () => {
      setPersisted(await requestPersistence())
      setUsage(await estimateUsage())

      // Prove the database survives a cold start: read what a previous launch wrote,
      // then write a fresh stamp for the next one.
      try {
        const previous = await store.get<string>('lastOpened')
        await store.set('lastOpened', new Date().toISOString())
        setRoundTrip(
          previous ? `last opened ${new Date(previous).toLocaleString()}` : 'first launch',
        )
      } catch (error) {
        setRoundTrip(`failed: ${String(error)}`)
      }
    })()
  }, [])

  return (
    <main className="screen">
      <header style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 24 }}>Platform check</h2>
        <p className="muted small" style={{ margin: '6px 0 0' }}>
          Confirms the app will run with no signal.
        </p>
      </header>

      <Card>
        <Row
          label="Offline ready"
          sub="The worker must be controlling, not merely registered"
          value={SW_LABEL[sw ?? 'none']}
          state={sw === 'controlling' ? 'ok' : sw === 'registered' ? 'warn' : 'bad'}
        />
        <Row
          label="Installed to home screen"
          value={isInstalled() ? 'yes' : 'no — still in browser'}
          state={isInstalled() ? 'ok' : 'warn'}
        />
        <Row label="Network" value={online ? 'online' : 'offline'} state="ok" />
        <Row
          label="Storage persistence"
          sub="Stops the season being evicted under storage pressure"
          value={persisted == null ? '…' : persisted ? 'granted' : 'not granted yet'}
          state={persisted ? 'ok' : 'warn'}
        />
        <Row label="Database" value={roundTrip} state={roundTrip.startsWith('failed') ? 'bad' : 'ok'} />
        {usage && <Row label="Storage used" value={usage} state="ok" />}
      </Card>

      <h2 style={{ fontSize: 15, color: 'var(--muted)', margin: '24px 0 10px', fontWeight: 600 }}>
        CAPABILITIES
      </h2>
      <Card>
        {caps.map((c) => (
          <Row
            key={c.id}
            label={c.label}
            value={c.ok ? 'available' : 'missing'}
            sub={c.detail}
            state={c.ok ? 'ok' : 'bad'}
          />
        ))}
      </Card>

      <h2 style={{ fontSize: 15, color: 'var(--muted)', margin: '24px 0 10px', fontWeight: 600 }}>
        YOUR DATA
      </h2>
      <Card>
        <Row
          label="Squad"
          value={`${season.players.length} ${season.players.length === 1 ? 'player' : 'players'}`}
          state="ok"
          sub="Stored only on this device — never uploaded"
        />
        <Row label="Fixtures" value={`${season.fixtures.length} saved`} state="ok" />
        <Row label="Saved matches" value={`${season.matches.length}`} state="ok" />
      </Card>

      <div className="stack" style={{ marginTop: 12 }}>
        <button
          className="btn-ghost btn-danger"
          disabled={season.matches.length === 0}
          onClick={() => {
            if (!confirm(`Delete all ${season.matches.length} saved matches? The squad and fixtures stay.`)) return
            for (const m of season.matches) dispatch({ type: 'DELETE_MATCH', id: m.id })
          }}
        >
          Clear saved matches
        </button>
        <button
          className="btn-ghost btn-danger"
          onClick={() => {
            // Two prompts on purpose: this is the one genuinely unrecoverable button in
            // the app, and there is no backup to restore from yet.
            if (!confirm('Erase the squad, fixtures and every match from this device?')) return
            if (!confirm('Really erase everything? This cannot be undone.')) return
            void store.del('season/v1').then(() => location.reload())
          }}
        >
          Erase everything on this device
        </button>
      </div>

      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 24, lineHeight: 1.5 }}>
        Build {BUILD}. To verify offline: install to the home screen, turn on flight mode,
        force-quit the app, then reopen it. Everything above should still render.
      </p>
    </main>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  )
}

type RowState = 'ok' | 'warn' | 'bad'

const DOT: Record<RowState, string> = {
  ok: 'var(--green)',
  warn: 'var(--amber)',
  bad: 'var(--red)',
}

function Row({
  label,
  value,
  sub,
  state,
}: {
  label: string
  value: string
  sub?: string
  state: RowState
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          flexShrink: 0,
          background: DOT[state],
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        {sub && <div style={{ color: 'var(--muted)', fontSize: 13 }}>{sub}</div>}
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 14, textAlign: 'right' }}>{value}</div>
    </div>
  )
}
