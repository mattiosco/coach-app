import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import type { MatchEvent } from '../domain/events'
import {
  creditMs,
  currentClock,
  foldMatch,
  gameCreditSupplyMs,
  goalMsFor,
  minutesPlayedMs,
  undoLast,
  type DayContext,
  type MatchInit,
  type MatchState,
} from '../domain/engine'
import {
  DEFAULT_CONFIG,
  DEFAULT_SLOTS,
  type Availability,
  type Fixture,
  type MatchConfig,
  type MatchId,
  type Player,
  type PlayerId,
  type Role,
  type Slot,
  type SlotId,
} from '../domain/types'
import { DEFAULT_SQUADI_URL } from '../lib/squadi'
import { store } from '../lib/storage'

export interface Votes {
  first?: PlayerId
  second?: PlayerId
  third?: PlayerId
}

/**
 * The line-up being built before kick-off. Persisted rather than held in component state
 * so it survives switching tabs, closing the app, and setting the team up at home hours
 * before the game.
 */
export interface SetupDraft {
  absent: PlayerId[]
  gk: PlayerId | null
  assignments: Record<SlotId, PlayerId | null>
  slots: Slot[]
}

/** A sub agreed with the girls now, made a few minutes later. */
export interface PlannedSub {
  slotId: SlotId
  off: PlayerId | null
  on: PlayerId
}

export interface StoredMatch {
  id: MatchId
  fixtureId: string | null
  label: string
  /** Which pitch, shown on the game screen — it matters when you arrive. */
  venue: string
  /** Local calendar date, grouping the two games of one match day. */
  dayKey: string
  config: MatchConfig
  init: MatchInit
  events: MatchEvent[]
  draft: SetupDraft | null
  plannedSubs: PlannedSub[]
  votes: Votes
  endedAt: number | null
}

/**
 * One team: its squad, its fixtures, its games. Everything below the team is exactly the
 * shape the screens have always consumed, so a coach running two teams switches context
 * with one tap and nothing bleeds between them.
 */
/** Per-team defaults, applied to each new match and editable per game. */
export interface TeamDefaults {
  playersPerSide: number
  gameMinutes: number
}

export const TEAM_DEFAULTS: TeamDefaults = { playersPerSide: 5, gameMinutes: 20 }

export interface Season {
  id: string
  name: string
  squadiUrl: string
  defaults: TeamDefaults
  players: Player[]
  fixtures: Fixture[]
  matches: StoredMatch[]
  activeMatchId: MatchId | null
  fixturesSyncedAt: number | null
}

export interface AppState {
  teams: Season[]
  activeTeamId: string
}

/** Local YYYY-MM-DD, so the two Friday games group together. */
export function dayKeyOf(iso: string | number | Date): string {
  const d = new Date(iso)
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export function emptyTeam(name: string, squadiUrl = ''): Season {
  return {
    id: crypto.randomUUID(),
    name,
    squadiUrl,
    defaults: { ...TEAM_DEFAULTS },
    players: [],
    fixtures: [],
    matches: [],
    activeMatchId: null,
    fixturesSyncedAt: null,
  }
}

const EMPTY_APP: AppState = (() => {
  const team = emptyTeam('My team', DEFAULT_SQUADI_URL)
  return { teams: [team], activeTeamId: team.id }
})()

const STORAGE_KEY = 'app/v2'
const LEGACY_KEY = 'season/v1'

export type Action =
  | { type: 'ADD_PLAYER'; name: string }
  | { type: 'RENAME_PLAYER'; id: PlayerId; name: string }
  | { type: 'SET_PREFERRED'; id: PlayerId; preferred: Role[] }
  | { type: 'REMOVE_PLAYER'; id: PlayerId }
  | { type: 'SET_FIXTURES'; fixtures: Fixture[]; syncedAt: number | null }
  | { type: 'EDIT_FIXTURE'; id: string; patch: Partial<Fixture> }
  | { type: 'ADD_FIXTURE'; fixture: Fixture }
  | { type: 'REMOVE_FIXTURE'; id: string }
  | { type: 'START_MATCH'; match: StoredMatch }
  | { type: 'SET_ACTIVE'; id: MatchId | null }
  | { type: 'APPEND'; id: MatchId; event: MatchEvent }
  | { type: 'UNDO'; id: MatchId; now: number }
  | { type: 'SET_CONFIG'; id: MatchId; config: MatchConfig }
  | { type: 'SET_VOTES'; id: MatchId; votes: Votes }
  | { type: 'SET_DRAFT'; id: MatchId; draft: SetupDraft }
  | { type: 'PLAN_SUBS'; id: MatchId; planned: PlannedSub[] }
  | { type: 'END_MATCH'; id: MatchId; at: number }
  | { type: 'DELETE_MATCH'; id: MatchId }
  | { type: 'SET_SQUADI_URL'; url: string }
  | { type: 'SET_TEAM_DEFAULTS'; defaults: TeamDefaults }
  // App-level: teams and restore.
  | { type: 'LOAD_APP'; app: AppState }
  | { type: 'TEAM_ADD'; name: string }
  | { type: 'TEAM_IMPORT'; team: Season }
  | { type: 'TEAM_RENAME'; id: string; name: string }
  | { type: 'TEAM_DELETE'; id: string }
  | { type: 'TEAM_SELECT'; id: string }

function patchMatch(season: Season, id: MatchId, fn: (m: StoredMatch) => StoredMatch): Season {
  return { ...season, matches: season.matches.map((m) => (m.id === id ? fn(m) : m)) }
}

export function teamReducer(season: Season, action: Action): Season {
  switch (action.type) {
    case 'ADD_PLAYER':
      return {
        ...season,
        players: [...season.players, { id: crypto.randomUUID(), name: action.name.trim() }],
      }

    case 'RENAME_PLAYER':
      return {
        ...season,
        players: season.players.map((p) =>
          p.id === action.id ? { ...p, name: action.name.trim() } : p,
        ),
      }

    case 'SET_PREFERRED':
      return {
        ...season,
        players: season.players.map((p) =>
          p.id === action.id ? { ...p, preferred: action.preferred } : p,
        ),
      }

    case 'REMOVE_PLAYER':
      return { ...season, players: season.players.filter((p) => p.id !== action.id) }

    case 'SET_FIXTURES':
      return { ...season, fixtures: action.fixtures, fixturesSyncedAt: action.syncedAt }

    case 'EDIT_FIXTURE':
      return {
        ...season,
        fixtures: season.fixtures.map((f) =>
          // Mark it edited so the next Squadi sync does not overwrite the correction.
          f.id === action.id ? { ...f, ...action.patch, edited: true } : f,
        ),
      }

    case 'ADD_FIXTURE':
      return {
        ...season,
        fixtures: [...season.fixtures, action.fixture].sort((a, b) =>
          a.startTime.localeCompare(b.startTime),
        ),
      }

    case 'REMOVE_FIXTURE':
      return { ...season, fixtures: season.fixtures.filter((f) => f.id !== action.id) }

    case 'START_MATCH':
      return {
        ...season,
        matches: [...season.matches.filter((m) => m.id !== action.match.id), action.match],
        activeMatchId: action.match.id,
      }

    case 'SET_ACTIVE':
      return { ...season, activeMatchId: action.id }

    case 'APPEND':
      return patchMatch(season, action.id, (m) => ({ ...m, events: [...m.events, action.event] }))

    case 'UNDO':
      return patchMatch(season, action.id, (m) => ({
        ...m,
        events: undoLast(season.players, m.init, m.events, action.now).events,
      }))

    case 'SET_CONFIG':
      return patchMatch(season, action.id, (m) => ({ ...m, config: action.config }))

    case 'SET_VOTES':
      return patchMatch(season, action.id, (m) => ({ ...m, votes: action.votes }))

    case 'SET_DRAFT':
      return patchMatch(season, action.id, (m) => ({ ...m, draft: action.draft }))

    case 'PLAN_SUBS':
      return patchMatch(season, action.id, (m) => ({ ...m, plannedSubs: action.planned }))

    case 'END_MATCH':
      // Stay on the match so the summary comes up straight away; the coach closes it.
      return patchMatch(season, action.id, (m) => ({ ...m, endedAt: action.at, plannedSubs: [] }))

    case 'DELETE_MATCH':
      return {
        ...season,
        matches: season.matches.filter((m) => m.id !== action.id),
        activeMatchId: season.activeMatchId === action.id ? null : season.activeMatchId,
      }

    case 'SET_SQUADI_URL':
      return { ...season, squadiUrl: action.url.trim() }

    case 'SET_TEAM_DEFAULTS':
      return { ...season, defaults: action.defaults }

    default:
      return season
  }
}

function patchActive(app: AppState, fn: (t: Season) => Season): AppState {
  return {
    ...app,
    teams: app.teams.map((t) => (t.id === app.activeTeamId ? fn(t) : t)),
  }
}

export function appReducer(app: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOAD_APP':
      return migrate(action.app)

    case 'TEAM_ADD': {
      const team = emptyTeam(action.name.trim() || 'New team')
      return { teams: [...app.teams, team], activeTeamId: team.id }
    }

    case 'TEAM_IMPORT':
      return { teams: [...app.teams, action.team], activeTeamId: action.team.id }

    case 'TEAM_RENAME':
      return {
        ...app,
        teams: app.teams.map((t) => (t.id === action.id ? { ...t, name: action.name.trim() } : t)),
      }

    case 'TEAM_DELETE': {
      const teams = app.teams.filter((t) => t.id !== action.id)
      if (teams.length === 0) return app // the last team cannot be deleted, only erased
      return {
        teams,
        activeTeamId: app.activeTeamId === action.id ? teams[0].id : app.activeTeamId,
      }
    }

    case 'TEAM_SELECT':
      return { ...app, activeTeamId: action.id }

    default:
      return patchActive(app, (t) => teamReducer(t, action))
  }
}

/**
 * Repairs to stored data on load.
 *
 * Practice matches used to take the calendar date as their day key, so a kickabout used
 * to test the app pooled its minutes with the real fixtures that evening and skewed
 * everyone's fair share. Give any such match a day of its own.
 */
function migrate(app: AppState): AppState {
  return {
    ...app,
    teams: app.teams.map((team) => ({
      ...team,
      defaults: team.defaults ?? { ...TEAM_DEFAULTS },
      matches: team.matches.map((m) =>
        m.fixtureId === null && !m.dayKey.startsWith('practice-')
          ? { ...m, dayKey: `practice-${m.id}` }
          : m,
      ),
    })),
  }
}

/** A season stored before teams existed, wrapped into the new shape. */
function fromLegacy(legacy: Partial<Season>): AppState {
  const team: Season = {
    ...emptyTeam('My team', DEFAULT_SQUADI_URL),
    players: legacy.players ?? [],
    fixtures: legacy.fixtures ?? [],
    matches: legacy.matches ?? [],
    activeMatchId: legacy.activeMatchId ?? null,
    fixturesSyncedAt: legacy.fixturesSyncedAt ?? null,
  }
  return { teams: [team], activeTeamId: team.id }
}

interface Ctx {
  app: AppState
  season: Season
  dispatch: (action: Action) => void
  loaded: boolean
}

const SeasonContext = createContext<Ctx | null>(null)

export function SeasonProvider({ children }: { children: ReactNode }) {
  const [app, dispatch] = useReducer(appReducer, EMPTY_APP)
  const loaded = useRef(false)
  const [, force] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    void (async () => {
      const saved = await store.get<AppState>(STORAGE_KEY)
      if (saved?.teams?.length) {
        dispatch({ type: 'LOAD_APP', app: saved })
      } else {
        const legacy = await store.get<Partial<Season>>(LEGACY_KEY)
        if (legacy) dispatch({ type: 'LOAD_APP', app: fromLegacy(legacy) })
      }
      loaded.current = true
      force()
    })()
  }, [])

  // Write through on every change. The whole store is a few kilobytes, so there is no
  // reason to be clever about it — and a half-written season is worse than a slow one.
  useEffect(() => {
    if (!loaded.current) return
    void store.set(STORAGE_KEY, app)
  }, [app])

  const season =
    app.teams.find((t) => t.id === app.activeTeamId) ?? app.teams[0] ?? EMPTY_APP.teams[0]

  const value = useMemo(
    () => ({ app, season, dispatch, loaded: loaded.current }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, season, loaded.current],
  )

  return <SeasonContext.Provider value={value}>{children}</SeasonContext.Provider>
}

export function useSeason(): Ctx {
  const ctx = useContext(SeasonContext)
  if (!ctx) throw new Error('useSeason must be used inside SeasonProvider')
  return ctx
}

export function activeMatch(season: Season): StoredMatch | null {
  return season.matches.find((m) => m.id === season.activeMatchId) ?? null
}

export function newMatch(
  fixture: Fixture | null,
  label: string,
  availability: Record<PlayerId, Availability>,
  config: MatchConfig = DEFAULT_CONFIG,
  slots: Slot[] = DEFAULT_SLOTS,
): StoredMatch {
  const id = crypto.randomUUID()
  return {
    id,
    fixtureId: fixture?.id ?? null,
    label,
    venue: fixture?.venue ?? '',
    // A practice match is its own day: it must not pool minutes with the real fixtures
    // that happen to fall on the same date.
    dayKey: fixture ? dayKeyOf(fixture.startTime) : `practice-${id}`,
    config,
    init: { slots, availability },
    events: [],
    draft: null,
    plannedSubs: [],
    votes: {},
    endedAt: null,
  }
}

/** The match already set up for this fixture, if there is one. */
export function matchForFixture(season: Season, fixtureId: string): StoredMatch | null {
  return season.matches.find((m) => m.fixtureId === fixtureId) ?? null
}

export function hasStarted(match: StoredMatch): boolean {
  return match.events.some((e) => e.t === 'LINEUP')
}

/**
 * Build the fairness context for a match day from the day's other games.
 *
 * Two games on one Friday are one outing as far as the girls are concerned, so credit
 * earned in the first game counts against the share owed in the second.
 */
export function dayContextFor(season: Season, match: StoredMatch): DayContext {
  const siblings = season.matches.filter((m) => m.dayKey === match.dayKey && m.id !== match.id)

  const priorCreditMs: Record<PlayerId, number> = {}
  const priorPlayedMs: Record<PlayerId, number> = {}
  const priorGkMs: Record<PlayerId, number> = {}
  const starts: Record<PlayerId, number> = {}

  for (const sibling of siblings) {
    const state = foldMatch(season.players, sibling.init, sibling.events)
    const clock = currentClock(state, Date.now())
    for (const player of season.players) {
      priorCreditMs[player.id] =
        (priorCreditMs[player.id] ?? 0) +
        creditMs(state, player.id, clock, sibling.config.gkWeight)
      priorGkMs[player.id] = (priorGkMs[player.id] ?? 0) + goalMsFor(state, player.id, clock)
      priorPlayedMs[player.id] =
        (priorPlayedMs[player.id] ?? 0) + minutesPlayedMs(state, player.id, clock)
    }
    for (const id of state.starters) starts[id] = (starts[id] ?? 0) + 1
  }

  // Fixtures still to come today count toward the day's supply, so the target does not
  // lurch upward the moment the second game is set up. A practice match is its own day:
  // it should not inherit a target sized for the two real games.
  const plannedToday = match.fixtureId
    ? season.fixtures.filter(
        (f) =>
          dayKeyOf(f.startTime) === match.dayKey && !siblings.some((m) => m.fixtureId === f.id),
      ).length
    : 1
  const gamesInDay = siblings.length + Math.max(1, plannedToday)

  const perGame = gameCreditSupplyMs(match.config, match.init.slots)
  return {
    priorCreditMs,
    priorPlayedMs,
    priorGkMs,
    starts,
    dayCreditMs: perGame * gamesInDay,
  }
}

/** Fold a stored match into live state. */
export function stateOf(season: Season, match: StoredMatch): MatchState {
  return foldMatch(season.players, match.init, match.events)
}
