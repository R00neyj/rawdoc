// 연결된 앱 API 래퍼 (specs/features/F-2148.md 2.3)
import { isConnectedAppList, type ConnectedApp } from './connectedApps'

export async function listConnectedApps(): Promise<ConnectedApp[]> {
  const res = await fetch('/api/connected-apps', { credentials: 'same-origin' })
  if (res.status !== 200) throw new Error(`status ${res.status}`)
  const data: unknown = await res.json()
  if (!isConnectedAppList(data)) throw new Error('invalid list')
  return data
}

export async function disconnectConnectedApp(id: string): Promise<'ok' | 'gone' | 'failed'> {
  try {
    const res = await fetch(`/api/connected-apps/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' })
    if (res.status === 204) return 'ok'
    if (res.status === 404) return 'gone'
    return 'failed'
  } catch {
    return 'failed'
  }
}
