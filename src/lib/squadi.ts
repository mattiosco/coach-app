import { DEFAULT_CONFIG, type Fixture } from '../domain/types'

/**
 * The Jillaroos BLUE draw — the link this app was born with, used as the default for the
 * first team so nothing breaks for the original coach.
 */
export const DEFAULT_SQUADI_URL =
  'https://registration.squadi.com/competitions?yearId=8&organisationKey=e7e36d43-4345-4cc2-bec2-77e8a44d34e4&competitionUniqueKey=d08ce360-d6ff-44b9-a4a2-542ff8b1d49b&divisionId=All&teamId=118318'

export interface SquadiRef {
  competitionKey: string
  teamId: number
}

/**
 * Pull the pieces we need out of a pasted Squadi draw link.
 *
 * The link is what a coach can actually get their hands on — open the draw on the
 * Squadi site with your team selected and copy the address. It carries the competition's
 * unique key and the team's numeric id, which is everything the API needs.
 */
export function parseSquadiUrl(url: string): SquadiRef {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    throw new Error('That does not look like a web address')
  }
  const competitionKey = parsed.searchParams.get('competitionUniqueKey')
  const teamId = Number(parsed.searchParams.get('teamId'))
  if (!competitionKey || !teamId) {
    throw new Error(
      'The link needs competitionUniqueKey and teamId — copy it from the Squadi draw page with your team selected',
    )
  }
  return { competitionKey, teamId }
}

const API = 'https://api.squadi.com/livescores'

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
 * Pull the season fixture from Squadi for the given draw link.
 *
 * Online-only by design: the app never depends on this to run. Fixtures are cached to
 * disk on a successful sync, and anything the coach has corrected by hand is preserved,
 * because the published draw is sometimes wrong and the correction is the better data.
 */
export async function fetchFixtures(squadiUrl: string, signal?: AbortSignal): Promise<Fixture[]> {
  const ref = parseSquadiUrl(squadiUrl)

  // The draw link carries the competition's unique key, but the matches endpoint wants
  // the numeric id. The public division endpoint maps one to the other.
  const divisionsResponse = await fetch(
    `${API}/division?competitionKey=${encodeURIComponent(ref.competitionKey)}`,
    { signal },
  )
  if (!divisionsResponse.ok) throw new Error(`Squadi returned ${divisionsResponse.status}`)
  const divisions = (await divisionsResponse.json()) as { competitionId?: number }[]
  const competitionId = divisions.find((d) => d.competitionId)?.competitionId
  if (!competitionId) throw new Error('Squadi does not recognise that competition link')

  const matchesResponse = await fetch(
    `${API}/round/matches?competitionId=${competitionId}&divisionId=&teamIds=[${ref.teamId}]&ignoreStatuses=[1]`,
    { signal },
  )
  if (!matchesResponse.ok) throw new Error(`Squadi returned ${matchesResponse.status}`)

  const data = (await matchesResponse.json()) as { rounds?: SquadiRound[] }
  return (data.rounds ?? []).flatMap((round) =>
    (round.matches ?? []).map((match) => toFixture(round, match, ref.teamId)),
  )
}

function toFixture(round: SquadiRound, match: SquadiMatch, teamId: number): Fixture {
  const home = match.team1Id === teamId
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
