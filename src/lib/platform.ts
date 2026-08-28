/**
 * Phase 0 exists to answer one question on the actual phone, in the actual paddock:
 * does this thing install, survive a cold start with no signal, and stay awake?
 * These probes make the answer visible instead of something we hope about.
 */
export type Capability = {
  id: string
  label: string
  detail: string
  ok: boolean
}

export function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari predates display-mode and reports it here instead.
    (navigator as { standalone?: boolean }).standalone === true
  )
}

export function probeCapabilities(): Capability[] {
  return [
    {
      id: 'sw',
      label: 'Service worker',
      detail: 'Caches the app so it opens with no signal',
      ok: 'serviceWorker' in navigator,
    },
    {
      id: 'idb',
      label: 'IndexedDB',
      detail: 'Stores the squad and every match',
      ok: 'indexedDB' in window,
    },
    {
      id: 'wakelock',
      label: 'Screen wake lock',
      detail: 'Stops the phone sleeping mid-game',
      ok: 'wakeLock' in navigator,
    },
    {
      id: 'vibrate',
      label: 'Vibration',
      detail: 'Buzzes at each shift change',
      ok: 'vibrate' in navigator,
    },
  ]
}

/** Keeps the screen on while a game clock is running. Released automatically on unmount. */
export async function acquireWakeLock(): Promise<(() => void) | null> {
  const nav = navigator as Navigator & {
    wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }
  }
  if (!nav.wakeLock) return null
  try {
    const sentinel = await nav.wakeLock.request('screen')
    return () => void sentinel.release()
  } catch {
    // Denied (usually because the tab is backgrounded). Not fatal.
    return null
  }
}

export type ServiceWorkerStatus =
  | 'unsupported'
  | 'none'
  | 'registered'
  | 'controlling'

/**
 * Whether the app is actually being served by the service worker. "registered" is not
 * good enough: until a worker is *controlling* the page, a cold start with no signal
 * will still fail. This is the single most important thing to confirm on the phone.
 */
export async function serviceWorkerStatus(): Promise<ServiceWorkerStatus> {
  if (!('serviceWorker' in navigator)) return 'unsupported'
  if (navigator.serviceWorker.controller) return 'controlling'
  const registrations = await navigator.serviceWorker.getRegistrations()
  return registrations.length > 0 ? 'registered' : 'none'
}
