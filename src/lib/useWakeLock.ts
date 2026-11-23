import { useEffect } from 'react'

type Sentinel = EventTarget & { released: boolean; release: () => Promise<void> }
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<Sentinel> }
}

/**
 * Keep the screen on for as long as `active` is true.
 *
 * The browser drops a wake lock whenever the app is hidden — a glance at a message, the
 * phone locking — and never hands it back by itself. So the lock is requested again each
 * time the app comes back into view, and again if it is released for any other reason
 * while we still want it. Without this the screen went dark the first time the coach
 * checked something else mid-game.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    const nav = navigator as WakeLockNavigator
    if (!active || !nav.wakeLock) return

    let sentinel: Sentinel | null = null
    let stopped = false
    let pending = false

    const acquire = async () => {
      if (stopped || pending || document.visibilityState !== 'visible') return
      if (sentinel && !sentinel.released) return
      pending = true
      try {
        const lock = await nav.wakeLock!.request('screen')
        if (stopped) {
          void lock.release()
          return
        }
        sentinel = lock
        // Released by the system (screen locked, tab hidden, battery saver): ask again as
        // soon as we are able to.
        lock.addEventListener('release', () => {
          sentinel = null
          void acquire()
        })
      } catch {
        // Refused — usually because the page is not visible yet. The next visibility
        // change tries again.
      } finally {
        pending = false
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      void sentinel?.release()
      sentinel = null
    }
  }, [active])
}
