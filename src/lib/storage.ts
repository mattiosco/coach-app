import { get, set, del } from 'idb-keyval'

/**
 * Ask the browser to make our storage persistent. Without this, iOS and Chrome are both
 * free to evict IndexedDB under storage pressure — which for us means losing a season's
 * roster and minutes. Best-effort: the answer is a browser heuristic, not a guarantee,
 * which is exactly why JSON export exists as a backstop (phase 5).
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted?.()) return true
  return navigator.storage.persist()
}

export async function estimateUsage(): Promise<string | null> {
  if (!navigator.storage?.estimate) return null
  const { usage, quota } = await navigator.storage.estimate()
  if (usage == null || quota == null) return null
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${mb(usage)} of ${mb(quota)}`
}

export const store = { get, set, del }
