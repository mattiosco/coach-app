import { useEffect, useState } from 'react'
import { probeCapabilities, isInstalled, type Capability } from './lib/platform'
import { requestPersistence, estimateUsage, store } from './lib/storage'

const BUILD = __BUILD_TIME__

export default function App() {
  const [caps] = useState<Capability[]>(probeCapabilities)
  const [online, setOnline] = useState(navigator.onLine)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<string | null>(null)
  const [roundTrip, setRoundTrip] = useState<string>('checking…')

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
    <main style={{ padding: 20, maxWidth: 560, margin: '0 auto' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 30, letterSpacing: -0.5 }}>Coach</h1>
        <p style={{ color: 'var(--muted)', margin: '6px 0 0' }}>
          Phase 0 — platform check
        </p>
      </header>

      <Card>
        <Row label="Installed to home screen" value={isInstalled() ? 'yes' : 'no — still in browser'} ok={isInstalled()} />
        <Row label="Network" value={online ? 'online' : 'offline'} ok />
        <Row label="Storage persistence" value={persisted == null ? '…' : persisted ? 'granted' : 'not granted'} ok={persisted !== false} />
        <Row label="Database" value={roundTrip} ok={!roundTrip.startsWith('failed')} />
        {usage && <Row label="Storage used" value={usage} ok />}
      </Card>

      <h2 style={{ fontSize: 15, color: 'var(--muted)', margin: '24px 0 10px', fontWeight: 600 }}>
        CAPABILITIES
      </h2>
      <Card>
        {caps.map((c) => (
          <Row key={c.id} label={c.label} value={c.ok ? 'available' : 'missing'} sub={c.detail} ok={c.ok} />
        ))}
      </Card>

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

function Row({ label, value, sub, ok }: { label: string; value: string; sub?: string; ok: boolean }) {
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
          background: ok ? 'var(--green)' : 'var(--red)',
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
