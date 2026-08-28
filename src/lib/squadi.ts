import { DEFAULT_CONFIG, type Fixture } from '../domain/types'

/** Our team in Squadi: FSW Jillaroos Social - Leeuwin Conference, team BLUE. */
export const SQUADI = {
  competitionId: 1598,
  teamId: 118318,
  teamName: 'BLUE',
}

const ENDPOINT = 'https://api.squadi.com/livescores/round/matches'

interface SquadiTeam {
  id: number
  name: string
}

interface SquadiMatch {
  id: number
  startTime: string
  team1Id: number
  team2Id: number
  team1?: SquadiTeam
  team2?: SquadiTeam
  matchDuration?: number
  venueCourt?: {
    name?: string
    venue?: { name?: string; shortName?: string; suburb?: string }
  }
}

interface SquadiRound {
  name: string
  matches: SquadiMatch[]
}

/**
 * Pull the season fixture from Squadi.
 *
 * Online-only by design: the app never depends on this to run. Fixtures are cached to
 * disk on a successful sync, and anything the coach has corrected by hand is preserved,
 * because the published draw is sometimes wrong and the correction is the better data.
 */
export async function fetchFixtures(signal?: AbortSignal): Promise<Fixture[]> {
  const url =
    `${ENDPOINT}?competitionId=${SQUADI.competitionId}` +
    `&divisionId=&teamIds=[${SQUADI.teamId}]&ignoreStatuses=[1]`

  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Squadi returned ${response.status}`)

  const data = (await response.json()) as { rounds?: SquadiRound[] }
  return (data.rounds ?? []).flatMap((round) =>
    (round.matches ?? []).map((match) => toFixture(round, match)),
  )
}

function toFixture(round: SquadiRound, match: SquadiMatch): Fixture {
  const home = match.team1Id === SQUADI.teamId
  const opponent = (home ? match.team2?.name : match.team1?.name) ?? 'Unknown'
  const venue = [match.venueCourt?.venue?.name, match.venueCourt?.name]
    .filter(Boolean)
    .join(' — ')

  return {
    id: String(match.id),
    round: round.name,
    startTime: match.startTime,
    opponent,
    homeAway: home ? 'home' : 'away',
    venue: venue || 'Venue TBC',
    source: 'squadi',
    config: {
      ...DEFAULT_CONFIG,
      totalMinutes: match.matchDuration ?? DEFAULT_CONFIG.totalMinutes,
      // Squadi publishes a halves flag, but whether a half is actually played is decided
      // by the game leader on the day — so it is deliberately not imported.
      periods: DEFAULT_CONFIG.periods,
    },
  }
}

/**
 * Fold freshly synced fixtures into what we already hold. Hand-edited fixtures and
 * manually added ones survive a sync untouched.
 */
export function mergeFixtures(existing: Fixture[], incoming: Fixture[]): Fixture[] {
  const byId = new Map(existing.map((f) => [f.id, f]))

  for (const fixture of incoming) {
    const current = byId.get(fixture.id)
    if (current?.edited) continue
    byId.set(fixture.id, { ...fixture, edited: current?.edited })
  }

  return [...byId.values()].sort((a, b) => a.startTime.localeCompare(b.startTime))
}

export function isUpcoming(fixture: Fixture, now = Date.now()): boolean {
  // A fixture stays "on" for a couple of hours after kickoff so it does not vanish from
  // the top of the list while you are still standing on the sideline using it.
  return new Date(fixture.startTime).getTime() > now - 3 * 60 * 60 * 1000
}
