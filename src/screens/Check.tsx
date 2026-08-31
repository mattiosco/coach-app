import { useEffect, useRef, useState } from 'react'
import {
  probeCapabilities,
  isInstalled,
  serviceWorkerStatus,
  type Capability,
  type ServiceWorkerStatus,
} from '../lib/platform'
import { requestPersistence, estimateUsage, store } from '../lib/storage'
import {
  backupPayload,
  deliverFile,
  parseImport,
  stamp,
  teamSharePayload,
  votesCsv,
} from '../lib/transfer'
import { useSeason } from '../state/store'

const BUILD = __BUILD_TIME__

const SW_LABEL: Record<ServiceWorkerStatus, string> = {
  unsupported: 'not supported',
  none: 'not registered',
  registered: 'registered, not yet active',
  controlling: 'yes — serving from cache',
}

export default function Check() {
  const { app, season, dispatch } = useSeason()
  const [caps] = useState<Capability[]>(probeCapabilities)
  const [online, setOnline] = useState(navigator.onLine)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<string | null>(null)
  const [sw, setSw] = useState<ServiceWorkerStatus | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

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
    })()
  }, [])

  const slug = season.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  const shareTeam = async () => {
    const how = await deliverFile(
      `team-${slug}-${stamp()}.coach.json`,
      'application/json',
      teamSharePayload(season),
    )
    setNotice(
      how === 'shared'
        ? 'Team file sent to the share sheet.'
        : 'Team file downloaded — send it to the other coach however you like.',
    )
  }

  const shareBackup = async () => {
    const how = await deliverFile(
      `coach-backup-${stamp()}.coach.json`,
      'application/json',
      backupPayload(app),
    )
    setNotice(
      how === 'shared'
        ? 'Backup sent to the share sheet.'
        : 'Backup downloaded — move it to the new device.',
    )
  }

  const shareCsv = async () => {
    const csv = votesCsv(season)
    if (!csv.includes('\n')) {
      setNotice('No finished matches to export yet.')
      return
    }
    const how = await deliverFile(`coach-${slug}-${stamp()}.csv`, 'text/csv', csv)
    setNotice(
      how === 'shared' ? 'CSV sent to the share sheet.' : 'CSV downloaded — open it in Excel.',
    )
  }

  const onImportFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const imported = parseImport(await file.text())
      if (imported.kind === 'team') {
        dispatch({ type: 'TEAM_IMPORT', team: imported.team })
        setNotice(
          `Imported "${imported.team.name}" with ${imported.team.players.length} players. It is now the selected team.`,
        )
      } else {
        if (
          !confirm(
            'This is a full backup. Restoring it REPLACES everything on this device — every team, match and vote. Continue?',
          )
        )
          return
        dispatch({ type: 'LOAD_APP', app: imported.app })
        setNotice('Backup restored.')
      }
    } catch (e) {
      setNotice(String(e instanceof Error ? e.message : e))
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <main className="screen">
      <header style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 24 }}>Check</h2>
        <p className="muted small" style={{ margin: '6px 0 0' }}>
          Offline health, backups and sharing.
        </p>
      </header>

      <div className="card">
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
        {usage && <Row label="Storage used" value={usage} state="ok" />}
        {caps
          .filter((c) => !c.ok)
          .map((c) => (
            <Row key={c.id} label={c.label} value="missing" sub={c.detail} state="bad" />
          ))}
      </div>

      <h2 className="section-title">SHARING &amp; BACKUP</h2>
      <div className="stack">
        <div className="card">
          <div className="row">
            <div className="grow">
              <div style={{ fontWeight: 600 }}>Share this team with another coach</div>
              <div className="muted small">
                {season.name}: squad, preferred spots and fixtures. Your votes and match
                history stay private.
              </div>
            </div>
            <button className="btn-sm" onClick={() => void shareTeam()}>
              Share
            </button>
          </div>
        </div>

        <div className="card">
          <div className="row">
            <div className="grow">
              <div style={{ fontWeight: 600 }}>Move everything to another device</div>
              <div className="muted small">
                Full backup: every team, match, minute and vote.
              </div>
            </div>
            <button className="btn-sm" onClick={() => void shareBackup()}>
              Export
            </button>
          </div>
        </div>

        <div className="card">
          <div className="row">
            <div className="grow">
              <div style={{ fontWeight: 600 }}>Spreadsheet for the PC</div>
              <div className="muted small">
                {season.name} as a CSV — minutes, goal time and your 3-2-1 votes per match.
              </div>
            </div>
            <button className="btn-sm" onClick={() => void shareCsv()}>
              Export
            </button>
          </div>
        </div>

        <div className="card">
          <div className="row">
            <div className="grow">
              <div style={{ fontWeight: 600 }}>Import a file</div>
              <div className="muted small">
                A team another coach shared, or a backup from your other device.
              </div>
            </div>
            <button className="btn-sm" onClick={() => fileInput.current?.click()}>
              Import
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,.coach.json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => void onImportFile(e.target.files?.[0])}
            />
          </div>
        </div>
      </div>

      {notice && (
        <p className="small" style={{ color: 'var(--amber)', margin: '10px 0 0', lineHeight: 1.5 }}>
          {notice}
        </p>
      )}

      <details style={{ marginTop: 14 }}>
        <summary className="muted small" style={{ minHeight: 40, cursor: 'pointer' }}>
          How sharing works — read me once
        </summary>
        <div className="muted small" style={{ lineHeight: 1.6, padding: '6px 2px' }}>
          <p>
            <strong>Giving a team to another coach:</strong> tap Share and send the file by
            AirDrop, WhatsApp, email — whatever you normally use. The other coach opens{' '}
            <strong>{location.origin + location.pathname}</strong> in their phone&apos;s
            browser, adds it to their home screen, then goes to this Check tab, taps Import
            and picks the file. They get the squad and fixtures as a new team; none of your
            votes or history travels with it.
          </p>
          <p>
            <strong>Moving to a new phone:</strong> Export the backup here, get the file onto
            the new device, install the app there the same way, then Import it. Restoring a
            backup replaces everything on that device, so do it on the new phone, not an old
            one you still use.
          </p>
          <p>
            <strong>The spreadsheet:</strong> the CSV opens straight into Excel. One row per
            player per finished match, with a vote_points column carrying your private 3-2-1
            as 3, 2 and 1.
          </p>
        </div>
      </details>

      <h2 className="section-title">YOUR DATA</h2>
      <div className="card">
        <Row
          label="Teams"
          value={`${app.teams.length}`}
          state="ok"
          sub="Stored only on this device — never uploaded"
        />
        <Row
          label={`${season.name} squad`}
          value={`${season.players.length} ${season.players.length === 1 ? 'player' : 'players'}`}
          state="ok"
        />
        <Row label="Fixtures" value={`${season.fixtures.length} saved`} state="ok" />
        <Row label="Saved matches" value={`${season.matches.length}`} state="ok" />
      </div>

      <div className="stack" style={{ marginTop: 12 }}>
        <button
          className="btn-ghost btn-danger"
          disabled={season.matches.length === 0}
          onClick={() => {
            if (
              !confirm(
                `Delete all ${season.matches.length} saved matches for ${season.name}? The squad and fixtures stay.`,
              )
            )
              return
            for (const m of season.matches) dispatch({ type: 'DELETE_MATCH', id: m.id })
          }}
        >
          Clear {season.name}&apos;s saved matches
        </button>
        <button
          className="btn-ghost btn-danger"
          onClick={() => {
            // Two prompts on purpose: this is the one genuinely unrecoverable button in
            // the app. Export a backup first if in any doubt.
            if (!confirm('Erase every team, fixture and match from this device?')) return
            if (!confirm('Really erase everything? This cannot be undone.')) return
            void Promise.all([store.del('app/v2'), store.del('season/v1')]).then(() =>
              location.reload(),
            )
          }}
        >
          Erase everything on this device
        </button>
      </div>

      <p className="muted small" style={{ marginTop: 24, lineHeight: 1.5 }}>
        Build {BUILD}. To verify offline: install to the home screen, turn on flight mode,
        force-quit the app, then reopen it. Everything above should still render.
      </p>
    </main>
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
    <div className="row">
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
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{label}</div>
        {sub && <div className="muted" style={{ fontSize: 13 }}>{sub}</div>}
      </div>
      <div className="muted" style={{ fontSize: 14, textAlign: 'right' }}>{value}</div>
    </div>
  )
}
