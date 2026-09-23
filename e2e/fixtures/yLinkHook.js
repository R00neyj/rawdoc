// 테스트 전용 원격 연결 훅 — 두 페이지 사이 중계를 테스트가 직접 한다 (specs/features/F-303.md 13.2)
import { expect } from '@playwright/test'

// 받은 포트를 window.__yPort 에, 편집기에서 나온 업데이트를 window.__yOutbox 에 쌓는다
export async function installYLinkHook(context) {
  await context.addInitScript(() => {
    window.__yProviderFactory = (port) => {
      window.__yPort = port
      window.__yOutbox = []
      const off = port.onLocalUpdate((update) => window.__yOutbox.push(Array.from(update)))
      return {
        destroy() {
          off()
          if (window.__yPort === port) window.__yPort = undefined
        },
      }
    }
  })
}

// 서로 다른 브라우저 컨텍스트 — IndexedDB·BroadcastChannel 이 갈라져 F-296 편집권이 끼지 않는다
export async function newLinkedPage(browser, baseURL) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1600, height: 900 },
    serviceWorkers: 'block',
  })
  await installYLinkHook(context)
  const page = await context.newPage()
  return { context, page }
}

// 연결 포트가 지금 연 문서의 것이 될 때까지 기다린다
export async function waitPortFor(page, docId) {
  await expect.poll(() => page.evaluate(() => window.__yPort?.docId ?? null)).toBe(docId)
}

// from 의 쌓인 업데이트를 비워 to 의 applyRemote 에 넣는다
export async function relay(from, to) {
  const updates = await from.evaluate(() => window.__yOutbox.splice(0))
  await to.evaluate((list) => {
    for (const update of list) window.__yPort.applyRemote(new Uint8Array(update))
  }, updates)
}

// B 가 A 상태를 입양하고, B 의 전체 상태를 A 에 넣는다 (8.3)
export async function joinPages(a, b) {
  const stateA = await a.evaluate(() => Array.from(window.__yPort.encodeState()))
  const adopted = await b.evaluate((state) => window.__yPort.adopt(new Uint8Array(state)), stateA)
  const stateB = await b.evaluate(() => Array.from(window.__yPort.encodeState()))
  await a.evaluate((state) => window.__yPort.applyRemote(new Uint8Array(state)), stateB)
  for (const page of [a, b]) await page.evaluate(() => window.__yOutbox.splice(0))
  return adopted
}

export async function portHolding(page) {
  return page.evaluate(() => window.__yPort.holding())
}

export async function portSharedText(page) {
  return page.evaluate(() => window.__yPort.sharedText())
}
