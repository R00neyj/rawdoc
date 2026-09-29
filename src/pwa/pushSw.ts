/// <reference lib="webworker" />
// 서비스 워커 푸시 처리기 — push-sw.js 로 따로 묶여 sw.js 가 importScripts 한다 (specs/features/F-3004.md 4장)
import { pickPushWindow, PUSH_OPEN_MESSAGE, pushClickUrl, pushNotificationSpec, type PushOpenMessage } from './pushSwCore'

declare const self: ServiceWorkerGlobalScope

function pushText(event: PushEvent): string | null {
  try {
    return event.data ? event.data.text() : null
  } catch {
    return null
  }
}

// 보이는 창이 있어도 늘 OS 알림 하나 — F-3001 Q6
self.addEventListener('push', (event) => {
  const { title, options } = pushNotificationSpec(pushText(event))
  event.waitUntil(self.registration.showNotification(title, options).catch(() => undefined))
})

async function openPushUrl(url: string): Promise<void> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const target = pickPushWindow(windows, self.location.origin)
  // focus() 가 거절되면 새 창으로 — Q3
  const focused = target ? await target.focus().catch(() => null) : null
  if (!focused) {
    await self.clients.openWindow(url)
    return
  }
  const message: PushOpenMessage = { type: PUSH_OPEN_MESSAGE, url }
  focused.postMessage(message)
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openPushUrl(pushClickUrl(event.notification.data)))
})
