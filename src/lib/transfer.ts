import { currentClock, foldMatch, goalMsFor, loanMsFor, minutesPlayedMs, MINUTE } from '../domain/engine'
import type { Fixture, Player, Role } from '../domain/types'
import { emptyTeam, type AppState, type Season, type Votes } from '../state/store'

/**
 * Moving data between phones without a server: everything travels as a file the coach
 * sends however they already send things — AirDrop, WhatsApp, email. Three shapes:
 *
 *  - a team share: squad and fixtures only, for handing a squad to another coach.
 *    Votes and match history deliberately never leave the phone this way.
 *  - a full backup: everything, for moving yourself to a new device.
 *  - a CSV: the season in rows, for a spreadsheet on a PC — votes included.
 */

interface TeamShare {
  type: 'coach-team'
  version: 1
  name: string
  squadiUrl: string
  players: { name: string; preferred?: Role[] }[]
  fixtures: Fixture[]
}

interface Backup {
  type: 'coach-backup'
  version: 2
  exportedAt: string
  app: AppState
}

export function teamSharePayload(team: Season): string {
  const payload: TeamShare = {
    type: 'coach-team',
    version: 1,
    name: team.name,
    squadiUrl: team.squadiUrl,
    players: team.players.map((p) => ({ name: p.name, preferred: p.preferred })),
    fixtures: team.fixtures,
  }
  return JSON.stringify(payload, null, 2)
}

export function backupPayload(app: AppState): string {
  const payload: Backup = {
    type: 'coach-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    app,
  }
  return JSON.stringify(payload, null, 2)
}

const VOTE_POINTS: [keyof Votes, number][] = [
  ['first', 3],
  ['second', 2],
  ['third', 1],
]

/** One row per player per finished match, ready for a pivot table. */
export function votesCsv(team: Season): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    'team,match,date,player,minutes,minutes_in_goal,minutes_lent,started,vote_points',
  ]

  for (const match of team.matches.filter((m) => m.endedAt)) {
    const state = foldMatch(team.players, match.init, match.events)
    const clock = currentClock(state, Date.now())
    const date = match.endedAt ? new Date(match.endedAt).toISOString().slice(0, 10) : ''
    const points = new Map<string, number>()
    for (const [key, value] of VOTE_POINTS) {
      const id = match.votes[key]
      if (id) points.set(id, value)
    }

    for (const player of team.players) {
      const mins = (ms: number) => Math.round((ms / MINUTE) * 10) / 10
      lines.push(
        [
          esc(team.name),
          esc(match.label),
          date,
          esc(player.name),
          mins(minutesPlayedMs(state, player.id, clock)),
          mins(goalMsFor(state, player.id, clock)),
          mins(loanMsFor(state, player.id, clock)),
          state.starters.includes(player.id) ? 1 : 0,
          points.get(player.id) ?? 0,
        ].join(','),
      )
    }
  }
  return lines.join('\n')
}

export type Imported = { kind: 'team'; team: Season } | { kind: 'backup'; app: AppState }

/** Read an import file. Throws with a human-sized message when it is not one of ours. */
export function parseImport(text: string): Imported {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('That file is not a coach app export')
  }
  const payload = data as {
    type?: string
    name?: string
    squadiUrl?: string
    players?: TeamShare['players']
    fixtures?: Fixture[]
    app?: AppState
  }

  if (payload.type === 'coach-team' && Array.isArray(payload.players)) {
    const team: Season = {
      ...emptyTeam(payload.name || 'Shared team', payload.squadiUrl ?? ''),
      // New ids on import: the players get a fresh identity in this phone's store, which
      // is safe because match history deliberately does not travel with a team share.
      players: payload.players.map(
        (p): Player => ({ id: crypto.randomUUID(), name: p.name, preferred: p.preferred }),
      ),
      fixtures: payload.fixtures ?? [],
    }
    return { kind: 'team', team }
  }

  if (payload.type === 'coach-backup' && payload.app?.teams?.length) {
    return { kind: 'backup', app: payload.app }
  }

  throw new Error('That file is not a coach app export')
}

/**
 * Hand a file to the user: the share sheet where the browser offers one (the phone
 * case — straight into AirDrop or WhatsApp), a plain download otherwise (the PC case).
 */
export async function deliverFile(
  filename: string,
  mime: string,
  content: string,
): Promise<'shared' | 'downloaded'> {
  const file = new File([content], filename, { type: mime })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch {
      // Cancelled or unsupported after all — fall through to a download.
    }
  }
  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
  return 'downloaded'
}

export function stamp(): string {
  return new Date().toISOString().slice(0, 10)
}
