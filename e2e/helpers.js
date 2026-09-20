// E2E 공용 조작 (specs/features/F-150.md 3.2)
// 저장소·설정은 각 테스트가 새 브라우저 컨텍스트(Playwright 의 기본 page fixture)에서
// 시작하므로 별도 초기화가 필요 없다 — 컨텍스트마다 IndexedDB·localStorage 가 비어 있다.
import { expect } from '@playwright/test'

const VIEW_MODE_LABEL = {
  live: '편집 — 서식을 보며 편집',
  raw: '원문 — 마크다운 기호 그대로 편집',
  view: '보기 — 읽기 전용으로 보기',
}

// 상단바 내보내기 버튼 툴팁·aria-label (F-279.md 3.2, 3.3) — 항목이 늘어도 이 값은 그대로다
export const EXPORT_BUTTON_LABEL = '내보내기'

// 내보내기 메뉴를 열고 항목 목록 로케이터를 돌려준다 (F-279.md 3.3)
export async function openExportMenu(page) {
  await page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true }).click()
  return page.locator('.export-menu-list [role="menuitem"]')
}

// 앱을 열고 부팅이 끝날 때까지 기다린다. 시작 화면 기본값은 홈(F-232)이라 md.startScreen='last' 를 미리 넣어 지금까지처럼 마지막 문서를 자동으로 연다 — 진짜 기본값 확인은 openAppHome
export async function openApp(page) {
  await setPrefBeforeLoad(page, 'md.startScreen', 'last')
  await page.goto('/')
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
}

// 진짜 기본값(홈 화면) 확인용 — md.startScreen 을 건드리지 않고 연다 (F-232 A2)
export async function openAppHome(page) {
  await page.goto('/')
  await expect(page.locator('.empty-state')).toBeVisible()
}

/** localStorage 설정을 첫 스크립트 실행 전에 넣는다(F-141 A2 첫 화면 값 확인용).
 * openApp/openAppHome 전에 호출해야 한다 */
export async function setPrefBeforeLoad(page, key, value) {
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [key, value],
  )
}

/** 숨은 가져오기 입력에 파일을 넣어 새 문서를 만든다 (F-150 3.2 "문서 넣기").
 * 키 입력 없이 원하는 원문을 그대로 문서로 만들 수 있다. 새 문서가 열릴 때까지 기다린다
 * @returns {Promise<string>} 새로 열린 문서 id
 */
export async function importMarkdown(page, { name = 'doc.md', content }) {
  const before = await currentDocId(page)
  const input = page.locator('input[data-import="md"]')
  await input.setInputFiles({ name, mimeType: 'text/markdown', buffer: Buffer.from(content, 'utf-8') })
  await expect
    .poll(async () => currentDocId(page))
    .not.toBe(before)
  return currentDocId(page)
}

/** 현재 해시(`#/d/{id}`)의 문서 id. 문서가 없으면 null */
export async function currentDocId(page) {
  return page.evaluate(() => {
    const m = /^#\/d\/(.+)$/.exec(location.hash)
    return m ? m[1] : null
  })
}

/** 저장이 끝난 뒤(상태바 "저장됨") IndexedDB 에서 문서 원문을 읽는다.
 * 화면 DOM 으로 원문을 모으지 않는다 — CM6 는 보이는 줄만 그린다 (F-150 3.2) */
export async function readSavedContent(page, docId) {
  await waitSaved(page)
  const id = docId ?? (await currentDocId(page))
  return page.evaluate(
    (docId) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('docs', 'readonly')
          const getReq = tx.objectStore('docs').get(docId)
          getReq.onsuccess = () => resolve(getReq.result ?? null)
          getReq.onerror = () => reject(getReq.error)
        }
      }),
    id,
  )
}

/** 상태바가 "저장됨" 을 보일 때까지 기다린다 */
export async function waitSaved(page) {
  await expect(page.locator('.statusbar-save')).toHaveText('저장됨', { timeout: 10_000 })
}

/** 상단바에서 모드를 바꾼다 */
export async function setViewMode(page, mode) {
  await page.getByRole('button', { name: VIEW_MODE_LABEL[mode], exact: true }).click()
}

/** 창 크기를 바꾼다 (사이드바 접기·툴팁 위치 등 반응형 확인용) */
export async function resizeWindow(page, width, height = 900) {
  await page.setViewportSize({ width, height })
}

/** CDP 로 한글 조합을 흉내 낸다 (F-150 3.2). 실제 IME 판정은 여전히 사람 몫이다.
 * 편집 영역에 포커스가 있는 상태에서 부른다 */
export async function fakeImeCompose(page, text) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
  return cdp
}

export async function fakeImeCommit(cdp, text) {
  await cdp.send('Input.insertText', { text })
}

/** 요소의 전환(transition)이 끝날 때까지 기다린다. 고정 대기 대신 실제 종료 이벤트를 쓴다 */
export async function waitTransitionEnd(locator) {
  await locator.evaluate(
    (el) =>
      new Promise((resolve) => {
        const cs = getComputedStyle(el)
        if (parseFloat(cs.transitionDuration) === 0) {
          resolve()
          return
        }
        const done = () => {
          el.removeEventListener('transitionend', done)
          resolve()
        }
        el.addEventListener('transitionend', done)
        setTimeout(resolve, 500) // 안전망 — 전환이 씹혀도 테스트가 멈추지 않게
      }),
  )
}

/** getComputedStyle 값 하나를 읽는다 */
export async function computedStyle(locator, prop) {
  return locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop)
}

/** --panel·--paper 같은 토큰 값을 실제 계산된 rgb() 로 바꿔 background-color 와 직접 비교할 수 있게 한다 */
export async function tokenAsRgb(page, tokenName) {
  return page.evaluate((name) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    const probe = document.createElement('div')
    probe.style.backgroundColor = value
    document.body.appendChild(probe)
    const rgb = getComputedStyle(probe).backgroundColor
    probe.remove()
    return rgb
  }, tokenName)
}

// 랜딩 HTML 을 '/' 에 한 번만 물린다 — preview 는 워커가 없어 '/' 가 항상 앱이다(F-271 9.2). 되돌이 확인처럼 두 번째 요청도 랜딩이어야 하면 두 번 부른다
export async function mockLanding(page) {
  const { renderWelcomePage } = await import('../worker/welcomePage.ts')
  const html = await renderWelcomePage().text()
  await page.route(
    (url) => url.pathname === '/',
    (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
    { times: 1 },
  )
}

/** 요소의 rect 를 읽는다 (JSON 으로 안전하게 직렬화) */
export async function rectOf(locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left }
  })
}
