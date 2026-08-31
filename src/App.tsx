import { useState } from 'react'
import Fixtures from './screens/Fixtures'
import Game from './screens/Game'
import Squad from './screens/Squad'
import Check from './screens/Check'
import { DEFAULT_CONFIG, type Fixture } from './domain/types'
import { activeMatch, matchForFixture, newMatch, useSeason } from './state/store'

type Tab = 'game' | 'fixtures' | 'squad' | 'check'

const fmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

export default function App() {
  const { season, dispatch } = useSeason()
  const [tab, setTab] = useState<Tab>('game')
  const running = activeMatch(season)

  const setUpFixture = (fixture: Fixture) => {
    // A match already set up for this fixture is picked up where it was left, rather
    // than silently replaced — that saved line-up may have been built at home.
    const existing = matchForFixture(season, fixture.id)
    if (existing) {
      dispatch({ type: 'SET_ACTIVE', id: existing.id })
      setTab('game')
      return
    }
    if (running && running.events.length > 0) {
      const ok = confirm(
        `A match is already running (${running.label}). Leave it and set up this one? The running match is kept.`,
      )
      if (!ok) return
    }
    const label = `v ${fixture.opponent} · ${fmt.format(new Date(fixture.startTime))}`
    dispatch({
      type: 'START_MATCH',
      match: newMatch(
        fixture,
        label,
        {},
        { ...DEFAULT_CONFIG, totalMinutes: fixture.config.totalMinutes },
      ),
    })
    setTab('game')
  }

  return (
    <div className="app">
      {tab === 'game' && <Game onNoMatch={() => setTab('fixtures')} />}
      {tab === 'fixtures' && <Fixtures onPick={setUpFixture} />}
      {tab === 'squad' && <Squad />}
      {tab === 'check' && <Check />}

      <nav className="tabs">
        <button aria-current={tab === 'game'} onClick={() => setTab('game')}>
          {running ? '● Game' : 'Game'}
        </button>
        <button aria-current={tab === 'fixtures'} onClick={() => setTab('fixtures')}>
          Fixtures
        </button>
        <button aria-current={tab === 'squad'} onClick={() => setTab('squad')}>
          Team
        </button>
        <button aria-current={tab === 'check'} onClick={() => setTab('check')}>
          Check
        </button>
      </nav>
    </div>
  )
}
