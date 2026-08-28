import { useState } from 'react'
import Fixtures from './screens/Fixtures'
import Game from './screens/Game'
import Squad from './screens/Squad'
import Check from './screens/Check'
import { DEFAULT_CONFIG, type Fixture } from './domain/types'
import { activeMatch, newMatch, useSeason } from './state/store'

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
    // Setting up a new match discards whatever is on the game screen, so never do that
    // silently to a game already in progress.
    if (running && running.events.length > 0) {
      const ok = confirm(
        `A match is already running (${running.label}). Start a new one and lose it?`,
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
          Squad
        </button>
        <button aria-current={tab === 'check'} onClick={() => setTab('check')}>
          Check
        </button>
      </nav>
    </div>
  )
}
