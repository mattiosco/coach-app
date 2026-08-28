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
import { foldMatch, undoLast, type MatchInit, type MatchState } from '../domain/engine'
import {
  DEFAULT_CONFIG,
  DEFAULT_SLOTS,
  type Availability,
  type Fixture,
  type MatchConfig,
  type MatchId,
  type Player,
  type PlayerId,
} from '../domain/types'
import { store } from '../lib/storage'

export interface Votes {
  first?: PlayerId
  second?: PlayerId
  third?: PlayerId
}

export interface StoredMatch {
  id: MatchId
  fixtureId: string | null
  label: string
  config: MatchConfig
  init: MatchInit
  events: MatchEvent[]
  votes: Votes
  endedAt: number | null
}

export interface Season {
  players: Player[]
  fixtures: Fixture[]
  matches: StoredMatch[]
  activeMatchId: MatchId | null
  fixturesSyncedAt: number | null
}

const EMPTY: Season = {
  players: [],
  fixtures: [],
  matches: [],
  activeMatchId: null,
  fixturesSyncedAt: null,
}

const STORAGE_KEY = 'season/v1'

export type Action =
  | { type: 'LOAD'; season: Season }
  | { type: 'ADD_PLAYER'; name: string }
  | { type: 'RENAME_PLAYER'; id: PlayerId; name: string }
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
  | { type: 'END_MATCH'; id: MatchId; at: number }
  | { type: 'DELETE_MATCH'; id: MatchId }

function patchMatch(season: Season, id: MatchId, fn: (m: StoredMatch) => StoredMatch): Season {
  return { ...season, matches: season.matches.map((m) => (m.id === id ? fn(m) : m)) }
}

export function reducer(season: Season, action: Action): Season {
  switch (action.type) {
    case 'LOAD':
      return action.season

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

    case 'END_MATCH':
      return {
        ...patchMatch(season, action.id, (m) => ({ ...m, endedAt: action.at })),
        activeMatchId: null,
      }

    case 'DELETE_MATCH':
      return {
        ...season,
        matches: season.matches.filter((m) => m.id !== action.id),
        activeMatchId: season.activeMatchId === action.id ? null : season.activeMatchId,
      }
  }
}

interface Ctx {
  season: Season
  dispatch: (action: Action) => void
  loaded: boolean
}

const SeasonContext = createContext<Ctx | null>(null)

export function SeasonProvider({ children }: { children: ReactNode }) {
  const [season, dispatch] = useReducer(reducer, EMPTY)
  const loaded = useRef(false)
  const [, force] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    void (async () => {
      const saved = await store.get<Season>(STORAGE_KEY)
      if (saved) dispatch({ type: 'LOAD', season: { ...EMPTY, ...saved } })
      loaded.current = true
      force()
    })()
  }, [])

  // Write through on every change. The whole season is a few kilobytes, so there is no
  // reason to be clever about it — and a half-written season is worse than a slow one.
  useEffect(() => {
    if (!loaded.current) return
    void store.set(STORAGE_KEY, season)
  }, [season])

  const value = useMemo(
    () => ({ season, dispatch, loaded: loaded.current }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [season, loaded.current],
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
): StoredMatch {
  return {
    id: crypto.randomUUID(),
    fixtureId: fixture?.id ?? null,
    label,
    config,
    init: { slots: DEFAULT_SLOTS, availability },
    events: [],
    votes: {},
    endedAt: null,
  }
}

/** Fold a stored match into live state. */
export function stateOf(season: Season, match: StoredMatch): MatchState {
  return foldMatch(season.players, match.init, match.events)
}
