// 위키링크 지도 3D 판 (F-2002~F-2012) — 캔버스 안은 판정하지 않고 클릭 적중·이름표·목록 통로로 판정한다. 삭제된 개수·속성 확인은 2026-09-29 e2e 정리
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, waitSaved, setPrefBeforeLoad, fakeImeCompose, fakeImeCommit } from './helpers.js'

// 사이드바 `지도` 버튼을 눌러 지도 화면을 연다
async function openMap(page) {
  await page.getByRole('button', { name: '지도' }).first().click()
  await expect(page.locator('.map-page')).toBeVisible()
  return page.locator('.map-page')
}

async function showList(map) {
  await map.getByRole('button', { name: '목록', exact: true }).click()
}

// F-2003 카메라 조작 (specs/features/F-2003.md 14.2) A1~A13 — 캔버스 안은 Playwright 가 못 보므로 "클릭이 노드에 맞느냐"로 조작을 판정한다. 첫 실행 상태는 노드가 하나뿐이라 맞춤 뒤 그 노드가 캔버스 한가운데에 놓이고 화면 반지름이 높이의 0.394배로 정해진다 (F-2003 7.2·14.2)
const NODE_R = 0.394
// 감쇠 꼬리가 약 110 프레임이라 조작 뒤 이만큼 기다린 다음 판정한다 (F-2003 4.2)
const SETTLE = 1200

async function openMapFresh(page) {
  // 빈 저장소로 바로 열면 지도도 "문서가 없습니다" 빈 상태다 — 노드 하나를 만들고 연다 (F-257 7장)
  await openApp(page)
  await page.goto('/#/map')
  const map = page.locator('.map-page')
  await expect(map).toBeVisible()
  await expect(map.locator('canvas')).toHaveCount(1)
  // reducedMotion 이라 배치가 한 번에 끝난다 — 안내 줄이 사라지는 것으로 준비 완료를 안다
  await expect(map.locator('.map-status')).toHaveCount(0)
  const box = await map.locator('.map-canvas').boundingBox()
  return { map, H: box.height, cx: box.x + box.width / 2, cy: box.y + box.height / 2 }
}

// 닫히는 중인 메뉴가 inert 로 잠깐 남는다 — F-281 A12/A13 이 이것 때문에 깨졌다
function nodeMenu(map) {
  return map.locator('.item-menu-list:not([inert])')
}

// 합성 이벤트로는 OrbitControls 가 안 움직인다 — 진짜 입력만 쓴다 (F-2003 4.2)
async function drag(page, x0, y0, dx, dy, button) {
  await page.mouse.move(x0, y0)
  await page.mouse.down({ button })
  const steps = 20
  for (let i = 1; i <= steps; i++) await page.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps)
  await page.mouse.up({ button })
}

// F-2004 노드 표현 (specs/features/F-2004.md 14.2) A1~A9 — 노드 크기·깊이 섞기·색은 캔버스 픽셀이라 판정하지 않고, DOM 인 이름표와 메뉴만 본다
function visibleLabels(map) {
  return map.locator('.map-label:not([hidden])')
}

async function labelBox(map, text) {
  return map.locator('.map-label', { hasText: text }).first().boundingBox()
}

// 첫 실행 문서를 막고 원하는 문서만 넣어 지도를 연다 (F-2004 14.2)
async function openMapWithDocs(page, docs) {
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.startScreen', 'last')
  await page.goto('/')
  await expect(page.locator('.empty-state')).toBeVisible()
  for (const doc of docs) await importMarkdown(page, doc)
  await page.goto('/#/map')
  const map = page.locator('.map-page')
  await expect(map).toBeVisible()
  await expect(map.locator('canvas')).toHaveCount(1)
  await expect(map.locator('.map-status')).toHaveCount(0)
  const box = await map.locator('.map-canvas').boundingBox()
  return { map, H: box.height, cx: box.x + box.width / 2, cy: box.y + box.height / 2 }
}

// 3D 배치의 좌표는 알 수 없다. 이름표가 떴다는 것이 곧 그 자리에 노드가 있다는 신호라 가운데부터 나선으로 훑는다 (F-2004 14.2)
async function hoverUntil(page, map, { cx, cy, H }, want) {
  const step = 0.028 * H
  const maxR = 0.4 * H
  const labels = visibleLabels(map)
  for (let r = 0; r <= maxR; r += step) {
    const count = r === 0 ? 1 : Math.max(6, Math.round((2 * Math.PI * r) / step))
    for (let k = 0; k < count; k++) {
      const a = (2 * Math.PI * k) / count
      const x = cx + r * Math.cos(a)
      const y = cy + r * Math.sin(a)
      await page.mouse.move(x, y)
      if (want(await labels.count())) return { x, y }
    }
  }
  throw new Error(`hoverUntil: 반지름 ${Math.round(maxR)}px 안에서 조건을 만족하는 노드를 못 찾았다`)
}

// 이름표는 제 노드 바로 아래에 붙는다 — 그 상자 위쪽을 2px 씩 올라가며 노드에 닿는 지점을 찾는다 (F-2004 7.4·14.2)
async function findNodeAboveLabel(page, map, text) {
  const box = await labelBox(map, text)
  const x = box.x + box.width / 2
  const labels = visibleLabels(map)
  for (let dy = 2; dy <= 80; dy += 2) {
    const y = box.y - dy
    await page.mouse.move(x, y)
    if ((await labels.count()) > 0) return { x, y }
  }
  throw new Error(`findNodeAboveLabel: 이름표 '${text}' 위 80px 안에서 노드를 못 찾았다`)
}

// F-2005 지도 설정 패널과 `표시` 3축 (specs/features/F-2005.md 12.2) A1~A13
function panel(map) {
  // 닫히는 동안 inert 로 남는다 — F-281 A12/A13 과 같은 함정이다
  return map.locator('.map-panel:not([inert])')
}

async function openPanel(map) {
  await map.getByRole('button', { name: '지도 설정', exact: true }).click()
  await expect(panel(map)).toBeVisible()
  return panel(map)
}

// F-2006 지도 설정 패널 `장력` 4축 (specs/features/F-2006.md 14.2) A1~A11 — 캔버스 안은 못 보므로 슬라이더가 시뮬레이션에 닿았는지는 이름표 DOM 의 화면 좌표와 노드 클릭 적중으로만 판정한다
const FORCE_NAMES = ['중심 장력', '반발력', '링크 장력', '링크 거리']
// MAP_FORCE_AXES 의 start 를 forceValueToNorm 으로 되돌린 값 (F-2006 4.7)
const FORCE_DEFAULTS = {
  '중심 장력': 0.6419391565964472,
  반발력: 0.6771752303951257,
  '링크 장력': 0.48430736193807317,
  '링크 거리': 0.17407765595569785,
}
// 장력 슬라이더가 일으킨 재가열은 reduced-motion 에서도 프레임마다 돈다 — 278 tick 이라 SETTLE 보다 오래 걸린다 (F-2006 5.2·9장)
const FORCE_SETTLE = 8000

// `장력` 묶음은 접힌 채로 뜬다 — 슬라이더를 잡으려면 먼저 펼쳐야 한다 (F-2006 7.1)
async function openForce(map) {
  const p = await openPanel(map)
  await p.getByRole('button', { name: '장력', exact: true }).click()
  return p
}

// `그룹` 묶음은 필터 아래에 접힌 채로 뜬다 (F-2008 7.1)
async function openGroup(map) {
  const p = await openPanel(map)
  await p.getByRole('button', { name: '그룹', exact: true }).click()
  return p
}

function forceSlider(p, name) {
  return p.getByRole('slider', { name, exact: true })
}

// F-2012 카메라 전환 (specs/features/F-2012.md 14.2) A1~A7 — 이름표 하나의 화면 x 를 프레임마다 읽어 카메라가 여러 프레임에 걸쳐 움직였는지 본다
const LABEL_ALL = '{"display":{"nodeScale":1,"labelDistance":1,"edgeStrength":0.5}}'

// 클릭 전에 부르고 await 하지 않는다. ms 동안 이름표 하나의 가운데 x 를 프레임마다 기록해 돌려준다 — 이름표는 translate(-50%) 라 가운데가 노드 x 다
function recordLabelX(page, ms) {
  return page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const xs = []
        const end = performance.now() + duration
        const tick = () => {
          const el = document.querySelector('.map-label:not([hidden])')
          if (el) {
            const r = el.getBoundingClientRect()
            xs.push([Math.round(performance.now()), Math.round((r.x + r.width / 2) * 10) / 10])
          }
          if (performance.now() < end) requestAnimationFrame(tick)
          else resolve(xs)
        }
        requestAnimationFrame(tick)
      }),
    ms,
  )
}

function distinctXs(xs) {
  return new Set(xs.map(([, x]) => x)).size
}

async function openMapLabeled(page) {
  await setPrefBeforeLoad(page, 'md.mapView', LABEL_ALL)
  const view = await openMapFresh(page)
  await expect(visibleLabels(view.map)).toHaveCount(1)
  return view
}

// F-2011 지도 머리 줄 아이콘 버튼화 (specs/features/F-2011.md 9장) A1~A9

function headButton(map, name) {
  return map.getByRole('button', { name, exact: true })
}

// F-2009 노드 끌기 (specs/features/F-2009.md 13.2) A1~A8 — 이름표는 translate(-50%) 로 노드 밑에 붙으므로 상자의 가운데 x 가 곧 노드의 화면 x 다
async function labelCenterX(map) {
  const box = await visibleLabels(map).first().boundingBox()
  return box.x + box.width / 2
}

async function dragHeld(page, x0, y0, dx, dy) {
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  const steps = 20
  for (let i = 1; i <= steps; i++) await page.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps)
  await page.waitForTimeout(100)
}

// F-2007 지도 설정 패널 `필터` 5항목 (specs/features/F-2007.md 16.2) A1~A14 — 전부 꼬리 줄 숫자와 `목록` 보기로 판정한다
async function openMapCentered(page, docs) {
  // 마지막으로 가져온 문서를 중심으로 지도를 연다 — `링크 단계` 는 중심이 없으면 잠긴다 (7.5)
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.startScreen', 'last')
  await page.goto('/')
  await expect(page.locator('.empty-state')).toBeVisible()
  let last = null
  for (const doc of docs) last = await importMarkdown(page, doc)
  await page.goto(`/#/map/${last}`)
  const map = page.locator('.map-page')
  await expect(map).toBeVisible()
  await expect(map.locator('canvas')).toHaveCount(1)
  await expect(map.locator('.map-status')).toHaveCount(0)
  const box = await map.locator('.map-canvas').boundingBox()
  return { map, id: last, H: box.height, cx: box.x + box.width / 2, cy: box.y + box.height / 2 }
}
const footFilter = (map) => map.locator('.map-foot-filter')

test('F-2002 A4·A5·A6·A7 목록 묶음, 항목 클릭으로 문서 열기, Ctrl+클릭 재중심, 끊긴 링크로 새 문서', async ({ page }) => {
  await openApp(page)
  const bId = await importMarkdown(page, { name: 'B.md', content: 'B 문서' })
  const aId = await importMarkdown(page, { name: 'A.md', content: '[[B]] [[없는 제목]]' })

  const map = await openMap(page)
  await showList(map)
  await expect(map.locator('.map-list-group h2', { hasText: '나가는 링크 (1)' })).toBeVisible()
  await expect(map.locator('.map-list-group h2', { hasText: '끊긴 링크 (1)' })).toBeVisible()
  await expect(map.locator('.map-list-group h2', { hasText: '연결이 많은 순' })).toBeVisible()

  await map.locator('.map-list-group').first().getByRole('button', { name: 'B', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`#/d/${bId}$`))
  await expect(page.locator('.map-page')).toHaveCount(0)

  const map2 = await openMap(page)
  await showList(map2)
  await map2.getByRole('button', { name: 'A', exact: true }).first().click({ modifiers: ['Control'] })
  await expect(page).toHaveURL(new RegExp(`#/map/${aId}$`))
  await expect(page.locator('.map-page')).toBeVisible()

  await map2.getByRole('button', { name: '없는 제목', exact: true }).click()
  await expect(page.locator('.doc-title')).toHaveValue('없는 제목')
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  await expect(page.locator('.map-page')).toHaveCount(0)

  const map3 = await openMap(page)
  await showList(map3)
  await expect(map3.locator('.map-list-group h2', { hasText: '끊긴 링크 (0)' })).toBeVisible()
})

test('F-2002 A9·F-2011 A8·F-2005 A10 WebGL 없음 — 목록으로 떨어지고 지도 버튼이 잠기고 설정 버튼은 남는다', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (typeof type === 'string' && type.startsWith('webgl')) return null
      return original.call(this, type, ...rest)
    }
  })
  await openApp(page)
  const map = await openMap(page)

  await expect(map.locator('.map-notice')).toContainText('이 브라우저에서는 3D 지도를 그릴 수 없습니다. 목록으로 보여 드립니다.')
  await expect(map.locator('canvas')).toHaveCount(0)
  await expect(map.locator('.map-list-group h2', { hasText: '연결이 많은 순' })).toBeVisible()
  await expect(headButton(map, '지도')).toHaveAttribute('aria-disabled', 'true')
  await expect(headButton(map, '지도 설정')).toHaveCount(1)
})

// F-138 3.2(편집 영역을 언마운트하면 저장된 편집을 옛 내용으로 덮어쓴다)를 지키는 유일한 테스트다
test('F-2002 A10·A11·A12 닫기·뒤로 가기는 열기 전 문서로, 지도를 다녀와도 방금 친 글자가 남고 실행 취소가 된다', async ({ page }) => {
  await openApp(page)
  const docId = await currentDocId(page)
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('방금친글자')
  await waitSaved(page)

  const map = await openMap(page)
  await map.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`#/d/${docId}$`))
  await expect(page.locator('.map-page')).toHaveCount(0)
  await expect(page.locator('.cm-content')).toContainText('방금친글자')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+z')
  await expect(page.locator('.cm-content')).not.toContainText('방금친글자')

  await openMap(page)
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`#/d/${docId}$`))
  await expect(page.locator('.map-page')).toHaveCount(0)
})

async function reopenMap(page) {
  await page.goto('/#/map')
  const map = page.locator('.map-page')
  await expect(map).toBeVisible()
  await expect(map.locator('canvas')).toHaveCount(1)
  await expect(map.locator('.map-status')).toHaveCount(0)
  return map
}

test.describe('F-2003 카메라 조작', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2003 A1·A6·A4·A5·A2·A3 노드 메뉴 — 항목 넷, 첫 클릭은 메뉴만 닫음, 새 탭, 여기로 이동, 배경 우클릭, 열기', async ({ page }) => {
    // 브라우저 기본 메뉴가 안 뜬다는 것을 자동으로 볼 통로는 defaultPrevented 뿐이다
    await page.addInitScript(() => {
      window.addEventListener('contextmenu', (e) => {
        document.documentElement.setAttribute('data-ctx-prevented', String(e.defaultPrevented))
      })
    })
    const { map, H, cx, cy } = await openMapFresh(page)
    await page.mouse.click(cx, cy, { button: 'right' })
    const items = nodeMenu(map).getByRole('menuitem')
    await expect(items).toHaveCount(4)
    await expect(items.nth(0)).toHaveText('열기')
    await expect(items.nth(1)).toHaveText('새 탭에서 열기')
    await expect(items.nth(2)).toHaveText('여기로 이동')
    await expect(items.nth(3)).toHaveText('이어진 문서만 보기')

    // A6 — 메뉴가 떠 있을 때의 첫 클릭은 메뉴만 닫는다
    await page.mouse.click(cx, cy)
    await expect(nodeMenu(map)).toHaveCount(0)
    await expect(page).toHaveURL(/#\/map$/)
    await expect(page.locator('.map-page')).toBeVisible()

    // A4 — 새 탭이 뜨고 지도는 그대로 있다. 고정 대기를 쓰지 않는다 — F-146 A8 이 그것 때문에 오래 깨져 있었다
    await page.mouse.click(cx, cy, { button: 'right' })
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      nodeMenu(map).getByRole('menuitem', { name: '새 탭에서 열기' }).click(),
    ])
    expect(popup.url()).toMatch(/#\/d\/[^/]+$/)
    await expect(page.locator('.map-page')).toBeVisible()

    // A5 — 해시가 그 문서로 바뀌고 지도는 그대로 있다
    await page.mouse.click(cx, cy, { button: 'right' })
    await nodeMenu(map).getByRole('menuitem', { name: '여기로 이동' }).click()
    await expect(page).toHaveURL(/#\/map\/[^/]+$/)
    await expect(page.locator('.map-page')).toBeVisible()

    // A2 — 배경 우클릭은 메뉴가 없고 기본 메뉴도 막힌다
    await page.mouse.click(cx + 0.45 * H, cy + 0.42 * H, { button: 'right' })
    await expect(nodeMenu(map)).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('data-ctx-prevented', 'true')

    // A3 — 열기: 그 문서가 열리고 지도가 닫힌다
    await page.mouse.click(cx, cy, { button: 'right' })
    await nodeMenu(map).getByRole('menuitem', { name: '열기', exact: true }).click()
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
    await expect(page.locator('.map-page')).toHaveCount(0)
  })

  test('F-2003 A7·A8·A9·A10·A14 카메라 — 이동·회전·휠·맞춤, 이미 중심인 문서에 여기로 이동을 다시 골라도 맞춰진다', async ({ page }) => {
    const { H, cx, cy } = await openMapFresh(page)
    const opened = /#\/d\/[^/]+$/

    // A7 — 좌클릭 드래그 = 이동. 원래 자리에는 이제 아무것도 없고 끈 만큼 옮겨 간 자리에 있다
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.55 * H, 0, 'left')
    await page.waitForTimeout(SETTLE)
    await page.mouse.click(cx, cy)
    await expect(page).toHaveURL(/#\/map$/)
    await page.mouse.click(cx + 0.55 * H, cy)
    await expect(page).toHaveURL(opened)

    // A8 — 우클릭 드래그 = 회전. 캔버스 높이의 1/2 을 끌면 180° 돈다 (F-2003 4.2)
    await reopenMap(page)
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.55 * H, 0, 'left')
    await page.waitForTimeout(SETTLE)
    await drag(page, cx - 0.3 * H, cy, 0.5 * H, 0, 'right')
    await page.waitForTimeout(SETTLE)
    await page.mouse.click(cx - 0.55 * H, cy)
    await expect(page).toHaveURL(opened)

    // A9 — 휠 축소 12칸 = 거리 ×1.85 → 화면 반지름이 0.394H 에서 0.213H 로 줄어든다
    await reopenMap(page)
    await page.mouse.move(cx, cy)
    await page.mouse.wheel(0, 1200)
    await page.waitForTimeout(SETTLE)
    await page.mouse.click(cx + 0.3 * H, cy)
    await expect(page).toHaveURL(/#\/map$/)
    await page.mouse.click(cx, cy)
    await expect(page).toHaveURL(opened)

    // A10 — 맞춤이 이동·회전·축소를 전부 되돌린다
    const map4 = await reopenMap(page)
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.55 * H, 0, 'left')
    await drag(page, cx - 0.3 * H, cy, 0.5 * H, 0, 'right')
    await page.mouse.move(cx, cy)
    await page.mouse.wheel(0, 1200)
    await page.waitForTimeout(SETTLE)
    await map4.getByRole('button', { name: '맞춤', exact: true }).click()
    await page.waitForTimeout(SETTLE)
    await page.mouse.click(cx + NODE_R * 0.76 * H, cy)
    await expect(page).toHaveURL(opened)

    // A14 — 2026-09-22 사용자 신고: 이미 중심인 문서에 `여기로 이동` 을 다시 골라도 카메라가 맞춰진다
    const map5 = await reopenMap(page)
    await page.mouse.click(cx, cy, { button: 'right' })
    await nodeMenu(map5).getByRole('menuitem', { name: '여기로 이동' }).click()
    await expect(page).toHaveURL(/#\/map\/[^/]+$/)
    await page.waitForTimeout(SETTLE)
    // 노드 위에서 시작하면 노드 끌기가 된다 — F-2009
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.55 * H, 0, 'left')
    await page.waitForTimeout(SETTLE)
    await page.mouse.click(cx + 0.55 * H, cy, { button: 'right' })
    await nodeMenu(map5).getByRole('menuitem', { name: '여기로 이동' }).click()
    await page.waitForTimeout(SETTLE)
    await page.mouse.click(cx, cy)
    await expect(page).toHaveURL(opened)
  })
})

test.describe('F-2003·F-2009 터치', () => {
  test.use({ reducedMotion: 'reduce', hasTouch: true })

  test('F-2009 A7·F-2003 A11·A12 터치 — 한 손가락 노드 끌기, 길게 누르면 메뉴가 남고, 짧게 누르면 그 문서가 열린다', async ({ page }) => {
    const { map, H, cx, cy } = await openMapFresh(page)
    const client = await page.context().newCDPSession(page)

    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] })
    for (let i = 1; i <= 6; i++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + (0.55 * H * i) / 6, y: cy }] })
    }
    // 마우스는 별개 포인터라 호버가 켜진다 — 그 자리에 노드가 있으면 이름표가 뜬다
    await page.mouse.move(cx + 0.55 * H, cy)
    await expect(visibleLabels(map)).toHaveCount(1)
    await expect(nodeMenu(map)).toHaveCount(0)
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(SETTLE)
    await page.mouse.move(cx, cy)
    await expect(visibleLabels(map)).toHaveCount(1)

    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] })
    await page.waitForTimeout(700)
    await expect(nodeMenu(map)).toBeVisible()
    // touchend 에서 preventDefault 를 안 하면 호환 mousedown 이 방금 연 메뉴를 닫는다 (F-2003 5.3)
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(nodeMenu(map)).toBeVisible()

    await page.mouse.click(cx + 0.45 * H, cy + 0.42 * H)
    await expect(nodeMenu(map)).toHaveCount(0)
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] })
    await page.waitForTimeout(150)
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
    await expect(map).toHaveCount(0)
  })
})

test.describe('F-2004 노드 표현', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2004 A1·A2·A3·A4 호버 이름표, 호버를 풀면 사라짐, 카메라를 따라옴, 클릭을 가로채지 않음', async ({ page }) => {
    const { map, H, cx, cy } = await openMapFresh(page)
    await expect(visibleLabels(map)).toHaveCount(0)
    await page.mouse.move(cx, cy)
    await expect(visibleLabels(map)).toHaveCount(1)
    await expect(visibleLabels(map)).toHaveText(['제목 없는 문서'])

    // 노드 밖 — 배경이다
    await page.mouse.move(cx + 0.45 * H, cy + 0.42 * H)
    await expect(visibleLabels(map)).toHaveCount(0)
    // 캔버스 밖으로 나가면 pointerleave 가 거둔다
    await page.mouse.move(cx, cy)
    await expect(visibleLabels(map)).toHaveCount(1)
    await map.locator('.map-page-title').hover()
    await expect(visibleLabels(map)).toHaveCount(0)

    // 노드 위에서 끌면 노드 끌기가 되므로 배경에서 이동한 뒤 옮겨 간 자리에서 다시 호버한다 (F-2009 14장)
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.25 * H, 0, 'left')
    await page.waitForTimeout(SETTLE)
    await page.mouse.move(cx + 0.25 * H, cy)
    await expect(visibleLabels(map)).toHaveCount(1)
    const box = await labelBox(map, '제목 없는 문서')
    expect(Math.abs(box.x + box.width / 2 - (cx + 0.25 * H))).toBeLessThanOrEqual(8)

    // 이름표 한가운데에서 잡히는 요소가 캔버스여야 한다 — pointer-events: none 이 아니면 span 이 잡힌다
    const atLabel = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.className ?? '',
      [box.x + box.width / 2, box.y + box.height / 2],
    )
    expect(atLabel).toContain('map-canvas')
    // 레이어가 캔버스를 통째로 덮고 있어도 클릭이 지나간다
    await page.mouse.click(cx + 0.25 * H, cy)
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
  })
})

test.describe('F-2004 이웃·끊긴 링크', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2004 A5 이웃까지 이름표', async ({ page }) => {
    const view = await openMapWithDocs(page, [
      { name: 'B.md', content: 'B 문서' },
      { name: 'A.md', content: 'A\n\n[[B]]' },
    ])
    await hoverUntil(page, view.map, view, (n) => n >= 1)

    await expect(visibleLabels(view.map)).toHaveCount(2)
    const texts = await visibleLabels(view.map).allTextContents()
    expect(texts.slice().sort()).toEqual(['A', 'B'])
  })

  test('F-2004 A6·A7 끊긴 링크 노드 메뉴는 하나, 이 제목으로 새 문서', async ({ page }) => {
    const view = await openMapWithDocs(page, [{ name: 'A.md', content: 'A\n\n[[없는 제목]]' }])
    await hoverUntil(page, view.map, view, (n) => n >= 1)
    await expect(visibleLabels(view.map)).toHaveCount(2)

    const spot = await findNodeAboveLabel(page, view.map, '없는 제목')
    await page.mouse.click(spot.x, spot.y, { button: 'right' })
    const items = nodeMenu(view.map).getByRole('menuitem')
    await expect(items).toHaveCount(1)
    await expect(items.first()).toHaveText('이 제목으로 새 문서')
    await items.first().click()

    await expect(page.locator('.doc-title')).toHaveValue('없는 제목')
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(page.locator('.map-page')).toHaveCount(0)
  })
})

test.describe('F-2005 지도 설정 패널', () => {
  test.use({ reducedMotion: 'reduce' })

  // F-2005 A4 기본값은 F-2006 A2 에, A5·A6 새로고침 유지는 `지도 설정 새로고침 유지` 하나에 합쳤다 (기본값 판정은 src/app/mapPrefs.test.ts U1)
  // F-2005 A8 깨진 저장값("{{{")은 src/app/mapPrefs.test.ts U2 가 같은 입력·기대값으로 본다
  test('F-2005 A1·A2·A9·A13·F-2011 A9 패널 여닫기, Esc 는 패널만 닫고 지도는 안 닫음, 목록으로 가도 남음, 이름표 표시 거리', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const btn = map.getByRole('button', { name: '지도 설정', exact: true })

    await btn.click()
    await expect(panel(map)).toBeVisible()
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    await expect(map.locator('canvas')).toHaveCount(1)
    await btn.click()
    await expect(panel(map)).toHaveCount(0)
    await expect(btn).toHaveAttribute('aria-expanded', 'false')

    await openPanel(map)
    await page.keyboard.press('Escape')
    await expect(panel(map)).toHaveCount(0)
    await expect(map).toBeVisible()
    await expect(page).toHaveURL(/#\/map$/)
    await expect(btn).toBeFocused()

    // F-2011 A9 — 패널이 없을 때 Esc 로는 지도가 안 닫힌다
    await page.keyboard.press('Escape')
    await expect(map).toBeVisible()
    await expect(page).toHaveURL(/#\/map/)

    // A9 — 필터·그룹은 목록에도 반영되므로 두 보기에서 다 패널을 열 수 있다 (F-2007 11.3, F-2008 7.1)
    await openPanel(map)
    await map.getByRole('button', { name: '목록', exact: true }).click()
    await expect(btn).toBeVisible()
    await expect(panel(map)).toBeVisible()
    await map.getByRole('button', { name: '지도', exact: true }).click()
    await expect(btn).toBeVisible()
    await expect(panel(map)).toBeVisible()

    // A13 — 이름표 표시 거리 슬라이더가 이름표에 닿는다 (거리 판정은 src/lib/mapNodeStyle.test.ts pickLabelNodes)
    const p = panel(map)
    await p.getByRole('button', { name: '표시', exact: true }).click()
    await expect(visibleLabels(map)).toHaveCount(0)
    await p.getByRole('slider', { name: '이름표 표시 거리', exact: true }).fill('1')
    await expect(visibleLabels(map)).toHaveCount(1)
    await expect(visibleLabels(map)).toHaveText(['제목 없는 문서'])
    await p.getByRole('slider', { name: '이름표 표시 거리', exact: true }).fill('0')
    await expect(visibleLabels(map)).toHaveCount(0)
  })
})

test.describe('F-2006 장력 묶음', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2006 A5·F-2005 A7·F-2007 A11·F-2008 A9 기본값으로가 표시·장력·필터를 되돌리고 그룹은 안 지운다', async ({ page }) => {
    const view = await openMapCentered(page, [
      { name: 'B.md', content: 'B 문서' },
      { name: 'A.md', content: 'A\n\n[[B]]' },
    ])
    const map = view.map
    const p = await openPanel(map)
    await p.getByRole('checkbox', { name: '고립 문서' }).uncheck()
    await p.getByRole('checkbox', { name: '끊긴 링크' }).uncheck()
    await p.getByRole('slider', { name: '링크 단계' }).fill('1')
    await p.getByRole('searchbox', { name: '파일 검색' }).fill('무언가')

    await p.getByRole('button', { name: '그룹', exact: true }).click()
    await p.getByRole('button', { name: '새 그룹', exact: true }).click()
    await p.getByRole('textbox', { name: '그룹 1 조건' }).fill('tag:일기')

    await p.getByRole('button', { name: '표시', exact: true }).click()
    await p.getByRole('slider', { name: '노드 크기', exact: true }).fill('2')
    await p.getByRole('slider', { name: '이름표 표시 거리', exact: true }).fill('0.6')
    await p.getByRole('slider', { name: '선 두께', exact: true }).fill('0.1')

    await p.getByRole('button', { name: '장력', exact: true }).click()
    await forceSlider(p, '중심 장력').fill('0.1')
    await forceSlider(p, '반발력').fill('0.95')
    await forceSlider(p, '링크 장력').fill('0.2')
    await forceSlider(p, '링크 거리').fill('0.8')

    await p.getByRole('button', { name: '기본값으로', exact: true }).click()

    await expect(p.getByRole('searchbox', { name: '파일 검색' })).toHaveValue('')
    await expect(p.getByRole('checkbox', { name: '고립 문서' })).toBeChecked()
    await expect(p.getByRole('checkbox', { name: '끊긴 링크' })).toBeChecked()
    await expect(p.getByRole('slider', { name: '링크 단계' })).toHaveValue('0')
    await expect(footFilter(map)).toHaveCount(0)
    expect(await p.getByRole('slider', { name: '노드 크기', exact: true }).inputValue()).toBe('1')
    expect(await p.getByRole('slider', { name: '이름표 표시 거리', exact: true }).inputValue()).toBe('0')
    expect(await p.getByRole('slider', { name: '선 두께', exact: true }).inputValue()).toBe('0.5')
    for (const name of FORCE_NAMES) {
      expect(Number(await forceSlider(p, name).inputValue())).toBeCloseTo(FORCE_DEFAULTS[name], 6)
    }
    await expect(p.locator('.map-group-row')).toHaveCount(1)

    // 닫고 다시 들어와도 되돌린 값이 유지된다
    await map.getByRole('button', { name: '닫기', exact: true }).click()
    await page.goto('/#/map')
    const map2 = page.locator('.map-page')
    await expect(map2).toBeVisible()
    const p2 = await openForce(map2)
    for (const name of FORCE_NAMES) {
      expect(Number(await forceSlider(p2, name).inputValue())).toBeCloseTo(FORCE_DEFAULTS[name], 6)
    }
  })


  test('F-2006 A11 링크 거리가 이어진 문서를 실제로 밀어낸다', async ({ page }) => {
    // 호버 없이 이름표가 다 뜨게 해 둔다. 고립 문서 C 가 있어야 카메라가 맞추는 반지름이 링크 거리와 무관해진다 (F-2006 4.2·14.2)
    await setPrefBeforeLoad(page, 'md.mapView', '{"display":{"nodeScale":1,"labelDistance":1,"edgeStrength":0.5}}')
    const view = await openMapWithDocs(page, [
      { name: 'C.md', content: 'C 문서' },
      { name: 'B.md', content: 'B 문서' },
      { name: 'A.md', content: 'A\n\n[[B]]' },
    ])
    await expect(visibleLabels(view.map)).toHaveCount(3)

    async function gap() {
      const a = await labelBox(view.map, 'A')
      const b = await labelBox(view.map, 'B')
      return Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2))
    }
    const before = await gap()

    const p = await openForce(view.map)
    await forceSlider(p, '링크 거리').fill('1')
    // 장력 중에는 카메라가 안 맞으므로 A 가 화면 밖으로 나간다 — 멈춘 뒤 맞춤으로 되돌려 잰다 (F-2012 13.2)
    await page.waitForTimeout(FORCE_SETTLE)
    await view.map.getByRole('button', { name: '맞춤', exact: true }).click()

    // 실측 301.1 px → 543.9 px (1.81배). 1.2 문턱은 그 아래로 50% 여유다 (F-2006 14.2)
    await expect.poll(async () => (await gap()) / before, { timeout: FORCE_SETTLE + 4000 }).toBeGreaterThan(1.2)
  })
})

// F-2010 A1(호버 픽셀 차이)은 시각 값, A4 는 F-2004 A5 와 같은 단언이라 e2e 에서 뺐다 — 흐리기 로직은 tests/src/lib/mapFocus.test.ts (2026-09-29 e2e 정리)

test.describe('F-2012 카메라 전환', () => {
  test('F-2012 A6 전환 중 사용자 조작이 이긴다', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(e))
    const { map, H, cx, cy } = await openMapLabeled(page)
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.55 * H, 0, 'left')
    await page.waitForTimeout(SETTLE)

    await page.mouse.click(cx + 0.55 * H, cy, { button: 'right' })
    await nodeMenu(map).getByRole('menuitem', { name: '여기로 이동' }).click()
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.3 * H, 0, 'left')
    await page.waitForTimeout(SETTLE)

    const box = await visibleLabels(map).first().boundingBox()
    expect(Math.abs(box.x + box.width / 2 - cx)).toBeGreaterThanOrEqual(0.2 * H)
    expect(errors).toEqual([])
  })
})

test.describe('F-2012 움직임 줄이기', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2012 A2·A4·A5 움직임 줄이기면 한 번에 가고, 장력을 바꿔도 카메라가 안 움직이고, 그 뒤 맞춤이 되돌린다', async ({ page }) => {
    const { map, H, cx, cy } = await openMapLabeled(page)
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.55 * H, 0, 'left')
    await page.waitForTimeout(SETTLE)

    const recording = recordLabelX(page, 900)
    await map.getByRole('button', { name: '맞춤', exact: true }).click()
    const xs = await recording
    expect(distinctXs(xs)).toBeLessThanOrEqual(2)
    expect(Math.abs(xs.at(-1)[1] - cx)).toBeLessThanOrEqual(4)

    await page.mouse.move(cx, cy)
    await page.mouse.wheel(0, 1200)
    await page.waitForTimeout(SETTLE)
    const before = await visibleLabels(map).first().boundingBox()

    const p = await openForce(map)
    await forceSlider(p, '반발력').fill('0.7')
    await page.waitForTimeout(FORCE_SETTLE)
    await map.getByRole('button', { name: '지도 설정', exact: true }).click()
    await expect(panel(map)).toHaveCount(0)

    // 노드 하나짜리 지도라 월드 좌표가 안 움직인다 — 이름표가 움직였다면 그것은 오직 카메라다 (F-2012 11장)
    const after = await visibleLabels(map).first().boundingBox()
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1)

    await map.getByRole('button', { name: '맞춤', exact: true }).click()
    await page.waitForTimeout(SETTLE)
    await page.mouse.click(cx + NODE_R * 0.76 * H, cy)
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
  })

  test('F-2012 A7 장력을 크게 바꾼 뒤에도 휠로 물러날 수 있다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.mapView', LABEL_ALL)
    const view = await openMapWithDocs(page, [
      { name: 'C.md', content: 'C 문서' },
      { name: 'B.md', content: 'B 문서' },
      { name: 'A.md', content: 'A\n\n[[B]]' },
    ])
    await expect(visibleLabels(view.map)).toHaveCount(3)

    const p = await openForce(view.map)
    await forceSlider(p, '링크 거리').fill('1')
    await page.waitForTimeout(FORCE_SETTLE)
    await view.map.getByRole('button', { name: '지도 설정', exact: true }).click()
    await expect(panel(view.map)).toHaveCount(0)

    await page.mouse.move(view.cx, view.cy)
    await page.mouse.wheel(0, 4000)
    await page.waitForTimeout(SETTLE)
    await expect(visibleLabels(view.map)).toHaveCount(3)
  })
})

// F-2011 A1~A7 은 텍스트·svg 개수·aria-pressed 만 보는 확인이고 A6 의 각 동작은 위 테스트가 이미 지난다 (2026-09-29 e2e 정리)

test.describe('F-2009 노드 끌기', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2009 A1·A2·A4·A3 노드가 커서를 따라오고, 놓으면 제자리로 돌아오고, 메뉴가 떠 있으면 끌리지 않고, 살짝 움직였다 뗀 것은 클릭이다', async ({ page }) => {
    const { map, H, cx, cy } = await openMapFresh(page)
    await page.mouse.move(cx, cy)
    await expect(visibleLabels(map)).toHaveCount(1)

    await dragHeld(page, cx, cy, 0.55 * H, 0)
    expect(Math.abs((await labelCenterX(map)) - (cx + 0.55 * H))).toBeLessThanOrEqual(8)
    await page.mouse.up()
    await page.waitForTimeout(SETTLE)

    // 노드 하나짜리 그래프는 놓고 1 tick 만에 원점으로 돌아온다 (F-2009 6.4)
    await page.mouse.click(cx + 0.55 * H, cy)
    await expect(page).toHaveURL(/#\/map$/)
    await page.mouse.move(cx, cy)
    await expect(visibleLabels(map)).toHaveCount(1)

    await page.mouse.click(cx, cy, { button: 'right' })
    await expect(nodeMenu(map)).toBeVisible()
    await dragHeld(page, cx, cy, 0.55 * H, 0)
    expect(Math.abs((await labelCenterX(map)) - cx)).toBeLessThanOrEqual(8)
    await page.mouse.up()
    await expect(nodeMenu(map)).toHaveCount(0)
    await expect(page).toHaveURL(/#\/map$/)

    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 3, cy)
    await page.mouse.up()
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
  })

  test('F-2009 A6 끄는 동안 이웃이 따라온다', async ({ page }) => {
    const view = await openMapWithDocs(page, [
      { name: 'B.md', content: 'B 문서' },
      { name: 'A.md', content: 'A\n\n[[B]]' },
    ])
    const at = await hoverUntil(page, view.map, view, (n) => n >= 2)
    const boxes = await Promise.all(['A', 'B'].map((t) => labelBox(view.map, t)))
    const centers = boxes.map((b) => b.x + b.width / 2)
    // 커서 바로 밑 노드가 끌리는 쪽이다 — 이름표는 노드 아래에 가운데를 맞춰 붙는다
    const other = Math.abs(centers[0] - at.x) <= Math.abs(centers[1] - at.x) ? 1 : 0
    const otherBefore = boxes[other]

    await dragHeld(page, at.x, at.y, 0.3 * view.H, 0)
    const otherAfter = await labelBox(view.map, other === 0 ? 'A' : 'B')
    expect(Math.hypot(otherAfter.x - otherBefore.x, otherAfter.y - otherBefore.y)).toBeGreaterThanOrEqual(10)
    await page.mouse.up()
  })
})

// F-2007 A3 은 F-2007 필터 테스트의 첫 단언과, A13·F-2008 A1·A2·A3·A13 은 설정 패널 테스트와 같은 확인이라 뺐다. 필터 판정은 tests/src/lib/mapFilter.test.ts (2026-09-29 e2e 정리)
test.describe('F-2007 지도 설정 패널 필터', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2007 A2·A4·A5·A6·A8·A9·A7 필터 — 기본값, 고립·끊긴 링크 끄기, 링크 단계, 파일 검색, 한글 입력기, 중심이 없으면 잠김', async ({ page }) => {
    const view = await openMapCentered(page, [
      { name: '사과.md', content: '사과 문서' },
      { name: 'D.md', content: 'D 문서' },
      { name: 'C.md', content: '[[D]]' },
      { name: 'B.md', content: '[[C]]' },
      { name: 'A.md', content: 'A\n\n[[B]] [[없는 제목]]' },
    ])
    const map = view.map
    const p = await openPanel(map)
    const isolated = p.getByRole('checkbox', { name: '고립 문서' })
    const broken = p.getByRole('checkbox', { name: '끊긴 링크' })
    const hops = p.getByRole('slider', { name: '링크 단계' })
    const search = p.getByRole('searchbox', { name: '파일 검색' })

    await expect(search).toHaveCount(1)
    await expect(isolated).toBeChecked()
    await expect(broken).toBeChecked()
    expect(await hops.inputValue()).toBe('0')
    await expect(footFilter(map)).toHaveCount(0)

    await isolated.uncheck()
    await expect(footFilter(map)).toHaveText('6개 중 5개 보임')
    await broken.uncheck()
    await expect(footFilter(map)).toHaveText('6개 중 4개 보임')
    await map.getByRole('button', { name: '목록', exact: true }).click()
    await expect(map.getByRole('button', { name: '사과', exact: true })).toHaveCount(0)
    await expect(map.locator('.map-list-group h2', { hasText: '끊긴 링크 (0)' })).toBeVisible()
    await map.getByRole('button', { name: '지도', exact: true }).click()
    await isolated.check()
    await broken.check()
    await expect(footFilter(map)).toHaveCount(0)

    // 중심이 있으면 잠김 안내가 없다 (F-2007 7.5 개정)
    await expect(hops).toHaveAccessibleDescription('')
    await hops.fill('1')
    await expect(footFilter(map)).toHaveText('6개 중 3개 보임')
    await hops.fill('2')
    await expect(footFilter(map)).toHaveText('6개 중 4개 보임')
    await hops.fill('0')
    await expect(footFilter(map)).toHaveCount(0)

    await search.fill('사과')
    await expect(footFilter(map)).toHaveText('6개 중 1개 보임')
    await search.focus()
    const cdp = await fakeImeCompose(page, '바')
    await page.waitForTimeout(200)
    // 조립 중에는 다시 거르지 않는다 — 먼저 확정된 값이 유지된다
    await expect(footFilter(map)).toHaveText('6개 중 1개 보임')
    await fakeImeCommit(cdp, '사과바')
    await expect(footFilter(map)).toHaveText('6개 중 0개 보임')

    // 중심이 없는 지도는 새로고침으로 검색어가 비워진 상태에서 연다
    await page.goto('/#/map')
    await page.reload()
    const map2 = page.locator('.map-page')
    await expect(map2).toBeVisible()
    await expect(map2.locator('canvas')).toHaveCount(1)
    const p2 = await openPanel(map2)
    const hops2 = p2.getByRole('slider', { name: '링크 단계' })
    await expect(hops2).toBeDisabled()
    await expect(hops2).toHaveAttribute('aria-valuetext', '현재 문서가 없습니다')
    await expect(hops2).toHaveAccessibleDescription('문서를 연 상태에서 지도를 열거나, 노드 메뉴의 ‘이어진 문서만 보기’를 쓰세요.')
  })

  test('F-2007 A12·A14 걸러진 노드는 안 열리고, 노드 메뉴의 이어진 문서만 보기가 링크 단계를 1 로 둔다', async ({ page }) => {
    const view = await openMapCentered(page, [
      { name: 'C.md', content: 'C 문서' },
      { name: 'B.md', content: '[[C]]' },
      { name: 'A.md', content: 'A\n\n[[B]]' },
    ])
    await hoverUntil(page, view.map, view, (n) => n >= 1)
    const spot = await findNodeAboveLabel(page, view.map, 'B')

    const p = await openPanel(view.map)
    await p.getByRole('searchbox', { name: '파일 검색' }).fill('A')
    await expect(footFilter(view.map)).toHaveText('3개 중 1개 보임')
    await view.map.getByRole('button', { name: '지도 설정', exact: true }).click()
    await expect(panel(view.map)).toHaveCount(0)

    await page.mouse.click(spot.x, spot.y)
    await expect(page).toHaveURL(/#\/map\/[^/]+$/)
    // 언마운트가 아니라 숨김이다 (F-2002 A1, F-138 3.2)
    await expect(page.locator('.cm-host .cm-editor')).toBeHidden()
    await page.mouse.move(spot.x, spot.y)
    await expect(visibleLabels(view.map)).toHaveCount(0)

    const p2 = await openPanel(view.map)
    await p2.getByRole('searchbox', { name: '파일 검색' }).fill('')
    await expect(footFilter(view.map)).toHaveCount(0)
    await view.map.getByRole('button', { name: '지도 설정', exact: true }).click()
    await expect(panel(view.map)).toHaveCount(0)

    await hoverUntil(page, view.map, view, (n) => n >= 1)
    const spot2 = await findNodeAboveLabel(page, view.map, 'B')
    await page.mouse.click(spot2.x, spot2.y, { button: 'right' })
    await nodeMenu(view.map).getByRole('menuitem', { name: '이어진 문서만 보기', exact: true }).click()

    await expect(page).not.toHaveURL(new RegExp(`#/map/${view.id}$`))
    await expect(page).toHaveURL(/#\/map\/[^/]+$/)
    const p3 = await openPanel(view.map)
    await expect(p3.getByRole('slider', { name: '링크 단계' })).toHaveValue('1')
    await expect(footFilter(view.map)).toHaveText('3개 중 3개 보임')
  })
})

test.describe('F-2008 지도 설정 패널 그룹', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2008 A4·A6·A5·A7·A12 색이 칠해지고, 앞 그룹이 우선하고, 색을 고르고, 삭제하면 번호를 다시 매기고, 한글 입력기 조립 중에는 안 칠한다', async ({ page }) => {
    const view = await openMapWithDocs(page, [
      { name: '사과.md', content: '사과 문서' },
      { name: '바나나.md', content: '바나나 문서' },
    ])
    const map = view.map
    const p = await openGroup(map)
    const add = p.getByRole('button', { name: '새 그룹', exact: true })
    const dot = (name) => map.getByRole('button', { name }).locator('.map-list-dot')

    await add.click()
    await p.getByRole('textbox', { name: '그룹 1 조건' }).fill('사과')
    await map.getByRole('button', { name: '목록', exact: true }).click()
    await expect(map.getByRole('button', { name: '사과' }).locator('.map-list-dot[data-group="1"]')).toHaveCount(1)
    await expect(dot('바나나')).toHaveCount(0)

    await p.getByRole('textbox', { name: '그룹 1 조건' }).fill('문서')
    await add.click()
    await p.getByRole('textbox', { name: '그룹 2 조건' }).fill('바나나')
    await expect(map.getByRole('button', { name: '바나나' }).locator('.map-list-dot[data-group="1"]')).toHaveCount(1)

    await p.locator('.map-group-row').first().getByRole('radio', { name: '색 3' }).check()
    await expect(map.getByRole('button', { name: '사과' }).locator('.map-list-dot[data-group="3"]')).toHaveCount(1)
    await expect(p.locator('.map-group-row').first().getByRole('radio', { name: '색 3' })).toBeChecked()

    await p.getByRole('textbox', { name: '그룹 1 조건' }).fill('사과')
    await expect(dot('사과')).toHaveCount(1)
    await expect(dot('바나나')).toHaveCount(1)
    await p.getByRole('button', { name: '그룹 1 삭제', exact: true }).click()
    await expect(p.locator('.map-group-row')).toHaveCount(1)
    await expect(p.getByRole('textbox', { name: '그룹 1 조건' })).toHaveValue('바나나')
    await expect(dot('사과')).toHaveCount(0)
    await expect(dot('바나나')).toHaveCount(1)

    const input = p.getByRole('textbox', { name: '그룹 1 조건' })
    await input.fill('')
    await expect(map.locator('.map-list-dot')).toHaveCount(0)
    await input.focus()
    const cdp = await fakeImeCompose(page, '바')
    await page.waitForTimeout(400)
    // 조립 중에는 다시 칠하지 않는다 — 앞서 확정된 상태(점 0개)가 유지된다
    await expect(map.locator('.map-list-dot')).toHaveCount(0)
    await fakeImeCommit(cdp, '바나나')
    await expect(dot('바나나')).toHaveCount(1)
  })
})

// F-2008 A1·A2·A3·A10·A13 은 섹션·행 개수·안내 문구만 봐서 뺐다 (상한 8 은 src/app/mapPrefs.test.ts U12). 표시·장력·필터 새로고침 유지는 아래 하나가 본다 (2026-09-29 e2e 정리)
test.describe('지도 설정 새로고침 유지', () => {
  test.use({ reducedMotion: 'reduce' })

  test('표시·장력·필터·그룹 값이 새로고침 뒤에도 남고 파일 검색 만 비워진다', async ({ page }) => {
    const view = await openMapCentered(page, [
      { name: 'B.md', content: 'B 문서' },
      { name: 'A.md', content: 'A\n\n[[B]]' },
    ])
    const p = await openPanel(view.map)
    await p.getByRole('checkbox', { name: '고립 문서' }).uncheck()
    await p.getByRole('slider', { name: '링크 단계' }).fill('2')
    await p.getByRole('searchbox', { name: '파일 검색' }).fill('아무거나')

    await p.getByRole('button', { name: '그룹', exact: true }).click()
    await p.getByRole('button', { name: '새 그룹', exact: true }).click()
    await p.getByRole('textbox', { name: '그룹 1 조건' }).fill('tag:일기')
    await p.getByRole('radio', { name: '색 3' }).check()

    await p.getByRole('button', { name: '표시', exact: true }).click()
    await p.getByRole('slider', { name: '노드 크기', exact: true }).fill('2.5')
    await p.getByRole('slider', { name: '이름표 표시 거리', exact: true }).fill('0.4')
    await p.getByRole('slider', { name: '선 두께', exact: true }).fill('0.9')

    await p.getByRole('button', { name: '장력', exact: true }).click()
    await forceSlider(p, '반발력').fill('0.9')
    await forceSlider(p, '링크 거리').fill('0.6')
    const keyed = forceSlider(p, '링크 장력')
    await keyed.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    const keyedValue = Number(await keyed.inputValue())

    await page.reload()
    const map2 = page.locator('.map-page')
    await expect(map2).toBeVisible()
    await expect(map2.locator('canvas')).toHaveCount(1)
    const p2 = await openPanel(map2)

    await expect(p2.getByRole('searchbox', { name: '파일 검색' })).toHaveValue('')
    await expect(p2.getByRole('checkbox', { name: '고립 문서' })).not.toBeChecked()
    await expect(p2.getByRole('slider', { name: '링크 단계' })).toHaveValue('2')

    await p2.getByRole('button', { name: '그룹', exact: true }).click()
    await expect(p2.locator('.map-group-row')).toHaveCount(1)
    await expect(p2.getByRole('textbox', { name: '그룹 1 조건' })).toHaveValue('tag:일기')
    await expect(p2.getByRole('radio', { name: '색 3' })).toBeChecked()

    await p2.getByRole('button', { name: '표시', exact: true }).click()
    await expect(p2.getByRole('slider', { name: '노드 크기', exact: true })).toHaveValue('2.5')
    await expect(p2.getByRole('slider', { name: '이름표 표시 거리', exact: true })).toHaveValue('0.4')
    await expect(p2.getByRole('slider', { name: '선 두께', exact: true })).toHaveValue('0.9')

    await p2.getByRole('button', { name: '장력', exact: true }).click()
    await expect(forceSlider(p2, '반발력')).toHaveValue('0.9')
    await expect(forceSlider(p2, '링크 거리')).toHaveValue('0.6')
    expect(Number(await forceSlider(p2, '링크 장력').inputValue())).toBeCloseTo(keyedValue, 6)
  })
})

// F-2013 호버 초점 전환 A1~A5 는 시각 값이라 e2e 에서 뺐다 — specs/human-checks.md (2026-09-25 e2e 경량화)

test.describe('F-2059 D13 지도 중심 없음', () => {
  test('목록에 없는 문서 id 로 #/map/{id} — 지도는 중심 없이 열리고 주소는 #/map', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() => {
      location.hash = '#/map/없는-문서'
    })
    await expect(page).toHaveURL(/#\/map$/)
  })
})
