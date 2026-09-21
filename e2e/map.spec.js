// 위키링크 지도 3D 판 (specs/features/F-2002.md 12.2) A1~A16 — 캔버스 안의 좌표·색·크기는 판정하지 않고, 노드 클릭 경로는 목록 통로로 판정한다 (F-292 11장)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, waitSaved, setPrefBeforeLoad } from './helpers.js'

// 사이드바 `지도` 버튼을 눌러 지도 화면을 연다
async function openMap(page) {
  await page.getByRole('button', { name: '지도' }).first().click()
  await expect(page.locator('.map-page')).toBeVisible()
  return page.locator('.map-page')
}

async function showList(map) {
  await map.getByRole('button', { name: '목록', exact: true }).click()
}

test.describe('F-2002 A1 열기', () => {
  test('사이드바 지도 클릭 — 전체 화면, 해시 #/map/{현재 문서 id}, 편집기 숨김', async ({ page }) => {
    await openApp(page)
    const docId = await currentDocId(page)
    await openMap(page)
    await expect(page).toHaveURL(new RegExp(`#/map/${docId}$`))
    // 언마운트가 아니라 숨김이다 — F-138 3.2 회귀를 막는 구조 (A12 가 동작으로 본다)
    await expect(page.locator('.cm-host .cm-editor')).toBeHidden()
    await expect(page.locator('.dialog[open]')).toHaveCount(0)
  })
})

test.describe('F-2002 A2 캔버스', () => {
  test('캔버스 하나가 role="img" 와 개수를 밝힌 aria-label 로 뜬다', async ({ page }) => {
    await openApp(page)
    const map = await openMap(page)
    const canvas = map.locator('canvas')
    await expect(canvas).toHaveCount(1)
    await expect(canvas).toHaveAttribute('role', 'img')
    await expect(canvas).toHaveAttribute('aria-label', /문서 \d+개, 연결 \d+개의 지도/)
  })
})

test.describe('F-2002 A3 머리 줄', () => {
  test('범위·단계 조작이 전부 사라지고 지도·목록·맞춤·닫기만 남는다', async ({ page }) => {
    await openApp(page)
    const map = await openMap(page)

    for (const gone of ['현재 문서', '전체', '1단계', '2단계', '3단계']) {
      await expect(map.getByRole('button', { name: gone, exact: true })).toHaveCount(0)
    }
    await expect(map.getByText('몇 다리까지')).toHaveCount(0)
    // 설정 패널을 여는 단추 (F-2005 5.1)
    await expect(map.getByRole('button', { name: '지도 설정', exact: true })).toHaveCount(1)

    await expect(map.getByRole('button', { name: '지도', exact: true })).toHaveCount(1)
    await expect(map.getByRole('button', { name: '목록', exact: true })).toHaveCount(1)
    await expect(map.getByRole('button', { name: '맞춤', exact: true })).toHaveCount(1)
    await expect(map.getByRole('button', { name: '닫기', exact: true })).toHaveCount(1)
  })
})

test.describe('F-2002 A4 목록 묶음', () => {
  test('나가는·끊긴 묶음과 연결이 많은 순 묶음이 함께 보인다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: 'B.md', content: 'B 문서' })
    await importMarkdown(page, { name: 'A.md', content: '[[B]] [[없는 제목]]' })

    const map = await openMap(page)
    await showList(map)

    await expect(map.locator('.map-list-group h2', { hasText: '나가는 링크 (1)' })).toBeVisible()
    await expect(map.locator('.map-list-group h2', { hasText: '끊긴 링크 (1)' })).toBeVisible()
    await expect(map.locator('.map-list-group h2', { hasText: '연결이 많은 순' })).toBeVisible()
  })
})

test.describe('F-2002 A5 목록으로 문서 열기', () => {
  test('나가는 링크 항목 클릭 — 그 문서가 열리고 지도는 닫힌다', async ({ page }) => {
    await openApp(page)
    const bId = await importMarkdown(page, { name: 'B.md', content: 'B 문서' })
    await importMarkdown(page, { name: 'A.md', content: '[[B]]' })

    const map = await openMap(page)
    await showList(map)
    await map.locator('.map-list-group').first().getByRole('button', { name: 'B', exact: true }).click()

    await expect(page).toHaveURL(new RegExp(`#/d/${bId}$`))
    await expect(page.locator('.map-page')).toHaveCount(0)
  })
})

test.describe('F-2002 A6 끊긴 링크', () => {
  test('끊긴 링크 항목 클릭 — 새 문서가 생겨 열리고, 다시 열면 끊긴 링크가 0이다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: 'A.md', content: '[[없는 제목]]' })

    const map = await openMap(page)
    await showList(map)
    await map.getByRole('button', { name: '없는 제목', exact: true }).click()

    await expect(page.locator('.doc-title')).toHaveValue('없는 제목')
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(page.locator('.map-page')).toHaveCount(0)

    const map2 = await openMap(page)
    await showList(map2)
    await expect(map2.locator('.map-list-group h2', { hasText: '끊긴 링크 (0)' })).toBeVisible()
  })
})

test.describe('F-2002 A7 Ctrl+클릭 재중심', () => {
  test('목록에서 Ctrl+클릭 — 해시가 그 문서로 바뀌고 지도는 그대로 있다', async ({ page }) => {
    await openApp(page)
    const bId = await importMarkdown(page, { name: 'B.md', content: 'B 문서' })
    await importMarkdown(page, { name: 'A.md', content: '[[B]]' })

    const map = await openMap(page)
    await showList(map)
    await map.locator('.map-list-group').first().getByRole('button', { name: 'B', exact: true }).click({ modifiers: ['Control'] })

    await expect(page).toHaveURL(new RegExp(`#/map/${bId}$`))
    await expect(page.locator('.map-page')).toBeVisible()
  })
})

test.describe('F-2002 A8 링크가 없을 때', () => {
  test('간선이 없어도 캔버스를 그대로 그리고 안내 줄만 겹친다', async ({ page }) => {
    await openApp(page) // 첫 실행 — 사용법 문서 하나뿐이고 위키링크가 없다
    const map = await openMap(page)

    await expect(map.locator('.map-notice')).toContainText('아직 이어진 문서가 없습니다.')
    await expect(map.getByRole('link', { name: '도움말' })).toBeVisible()
    await expect(map.locator('canvas')).toHaveCount(1)
  })
})

test.describe('F-2002 A9 WebGL 없음', () => {
  test('webgl2 컨텍스트를 못 얻으면 목록으로 떨어지고 지도 세그먼트가 잠긴다', async ({ page }) => {
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
    await expect(map.getByRole('button', { name: '지도', exact: true })).toHaveAttribute('aria-disabled', 'true')
  })
})

test.describe('F-2002 A10 닫기', () => {
  test('닫기 — 열기 전 문서로 돌아온다', async ({ page }) => {
    await openApp(page)
    const docId = await currentDocId(page)
    const map = await openMap(page)

    await map.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`#/d/${docId}$`))
    await expect(page.locator('.map-page')).toHaveCount(0)
  })
})

test.describe('F-2002 A11 뒤로 가기', () => {
  test('브라우저 뒤로 가기 — 열기 전 문서로 돌아온다', async ({ page }) => {
    await openApp(page)
    const docId = await currentDocId(page)
    await openMap(page)

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`#/d/${docId}$`))
    await expect(page.locator('.map-page')).toHaveCount(0)
  })
})

test.describe('F-2002 A12 편집 보존 회귀', () => {
  // F-138 3.2(편집 영역을 언마운트하면 저장된 편집을 옛 내용으로 덮어쓴다)를 지키는 유일한 테스트다
  test('문서를 고치고 지도 → 닫기 → 같은 문서 — 방금 친 글자가 남고 실행 취소가 된다', async ({ page }) => {
    await openApp(page)
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('방금친글자')
    await waitSaved(page)

    const map = await openMap(page)
    await map.getByRole('button', { name: '닫기', exact: true }).click()

    await expect(page.locator('.cm-content')).toContainText('방금친글자')
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+z')
    await expect(page.locator('.cm-content')).not.toContainText('방금친글자')
  })
})

test.describe('F-2002 A13 직접 진입', () => {
  test('#/map 주소로 새로 열면 지도와 캔버스가 뜬다', async ({ page }) => {
    await page.goto('/#/map')
    await expect(page.locator('.map-page')).toBeVisible()
    await expect(page.locator('.map-page canvas')).toHaveCount(1)
  })
})

test.describe('F-2002 A14 꼬리 줄', () => {
  test('노드 수와 간선 수를 적는다', async ({ page }) => {
    await openApp(page) // 첫 실행 `사용법` 문서가 하나 있으므로 가져온 둘과 합쳐 3개다
    await importMarkdown(page, { name: 'B.md', content: 'B 문서' })
    await importMarkdown(page, { name: 'A.md', content: '[[B]]' })

    const map = await openMap(page)
    await expect(map.locator('.map-page-foot')).toContainText('노드 3개 · 간선 1개')
  })
})

test.describe('F-2002 A15 테마 전환', () => {
  test('지도를 연 채 테마를 다크로 바꿔도 장면이 살아 있고 오류가 나지 않는다', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))

    await openApp(page)
    const map = await openMap(page)
    await expect(map.locator('canvas')).toHaveCount(1)

    await page.getByRole('button', { name: '설정', exact: true }).click()
    await page.getByRole('radio', { name: '다크' }).click()
    await page.locator('.dialog[open]').getByRole('button', { name: '닫기', exact: true }).click()

    await expect(map.locator('canvas')).toHaveCount(1)
    await expect(page.locator('.map-page')).toBeVisible()
    expect(errors).toEqual([])
  })
})

test.describe('F-2002 A16 맞춤', () => {
  test('맞춤을 눌러도 장면이 깨지지 않는다', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))

    await openApp(page)
    const map = await openMap(page)
    await map.getByRole('button', { name: '맞춤', exact: true }).click()

    await expect(map.locator('canvas')).toHaveCount(1)
    expect(errors).toEqual([])
  })
})

// F-2003 카메라 조작 (specs/features/F-2003.md 14.2) A1~A13 — 캔버스 안은 Playwright 가 못 보므로 "클릭이 노드에 맞느냐"로 조작을 판정한다. 첫 실행 상태는 노드가 하나뿐이라 맞춤 뒤 그 노드가 캔버스 한가운데에 놓이고 화면 반지름이 높이의 0.394배로 정해진다 (F-2003 7.2·14.2)
const NODE_R = 0.394
// 감쇠 꼬리가 약 110 프레임이라 조작 뒤 이만큼 기다린 다음 판정한다 (F-2003 4.2)
const SETTLE = 1200

async function openMapFresh(page) {
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

test.describe('F-2003 카메라 조작', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2003 A1 노드 우클릭 — 항목 셋짜리 메뉴', async ({ page }) => {
    const { map, cx, cy } = await openMapFresh(page)
    await page.mouse.click(cx, cy, { button: 'right' })

    const items = nodeMenu(map).getByRole('menuitem')
    await expect(items).toHaveCount(3)
    await expect(items.nth(0)).toHaveText('열기')
    await expect(items.nth(1)).toHaveText('새 탭에서 열기')
    await expect(items.nth(2)).toHaveText('여기로 이동')
  })

  test('F-2003 A2 배경 우클릭 — 메뉴가 없고 브라우저 기본 메뉴도 막힌다', async ({ page }) => {
    // 브라우저 기본 메뉴가 안 뜬다는 것을 자동으로 볼 통로는 defaultPrevented 뿐이다
    await page.addInitScript(() => {
      window.addEventListener('contextmenu', (e) => {
        document.documentElement.setAttribute('data-ctx-prevented', String(e.defaultPrevented))
      })
    })
    const { map, H, cx, cy } = await openMapFresh(page)
    await page.mouse.click(cx + 0.45 * H, cy + 0.42 * H, { button: 'right' })

    await expect(nodeMenu(map)).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('data-ctx-prevented', 'true')
  })

  test('F-2003 A3 메뉴 열기 — 그 문서가 열리고 지도가 닫힌다', async ({ page }) => {
    const { map, cx, cy } = await openMapFresh(page)
    await page.mouse.click(cx, cy, { button: 'right' })
    await nodeMenu(map).getByRole('menuitem', { name: '열기', exact: true }).click()

    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
    await expect(page.locator('.map-page')).toHaveCount(0)
  })

  test('F-2003 A4 메뉴 새 탭에서 열기 — 새 탭이 뜨고 지도는 그대로 있다', async ({ page }) => {
    const { map, cx, cy } = await openMapFresh(page)
    await page.mouse.click(cx, cy, { button: 'right' })

    // 고정 대기를 쓰지 않는다 — F-146 A8 이 그것 때문에 오래 깨져 있었다
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      nodeMenu(map).getByRole('menuitem', { name: '새 탭에서 열기' }).click(),
    ])
    expect(popup.url()).toMatch(/#\/d\/[^/]+$/)
    await expect(page.locator('.map-page')).toBeVisible()
  })

  test('F-2003 A5 메뉴 여기로 이동 — 해시가 그 문서로 바뀌고 지도는 그대로 있다', async ({ page }) => {
    const { map, cx, cy } = await openMapFresh(page)
    await page.mouse.click(cx, cy, { button: 'right' })
    await nodeMenu(map).getByRole('menuitem', { name: '여기로 이동' }).click()

    await expect(page).toHaveURL(/#\/map\/[^/]+$/)
    await expect(page.locator('.map-page')).toBeVisible()
  })

  test('F-2003 A6 메뉴가 떠 있을 때의 첫 클릭은 메뉴만 닫는다', async ({ page }) => {
    const { map, cx, cy } = await openMapFresh(page)
    await page.mouse.click(cx, cy, { button: 'right' })
    await expect(nodeMenu(map)).toBeVisible()

    await page.mouse.click(cx, cy)
    await expect(nodeMenu(map)).toHaveCount(0)
    await expect(page).toHaveURL(/#\/map$/)
    await expect(page.locator('.map-page')).toBeVisible()
  })

  test('F-2003 A7 좌클릭 드래그 = 이동 — 노드가 끈 만큼 따라온다', async ({ page }) => {
    const { H, cx, cy } = await openMapFresh(page)
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.55 * H, 0, 'left')
    await page.waitForTimeout(SETTLE)

    // 원래 자리에는 이제 아무것도 없다
    await page.mouse.click(cx, cy)
    await expect(page).toHaveURL(/#\/map$/)
    // 끈 만큼 옮겨 간 자리에 있다 — 레이캐스트가 카메라를 따라갔다는 직접 증거다
    await page.mouse.click(cx + 0.55 * H, cy)
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
  })

  test('F-2003 A8 우클릭 드래그 = 회전 — 180° 돌면 반대쪽으로 간다', async ({ page }) => {
    const { H, cx, cy } = await openMapFresh(page)
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.55 * H, 0, 'left')
    await page.waitForTimeout(SETTLE)
    // 캔버스 높이의 1/2 을 끌면 180° 돈다 (F-2003 4.2)
    await drag(page, cx - 0.3 * H, cy, 0.5 * H, 0, 'right')
    await page.waitForTimeout(SETTLE)

    await page.mouse.click(cx - 0.55 * H, cy)
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
  })

  test('F-2003 A9 휠 — 축소하면 노드가 작아진다', async ({ page }) => {
    const { H, cx, cy } = await openMapFresh(page)
    await page.mouse.move(cx, cy)
    // 12칸 축소 = 거리 ×1.85 → 화면 반지름이 0.394H 에서 0.213H 로 줄어든다
    await page.mouse.wheel(0, 1200)
    await page.waitForTimeout(SETTLE)

    await page.mouse.click(cx + 0.3 * H, cy)
    await expect(page).toHaveURL(/#\/map$/)
    await page.mouse.click(cx, cy)
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
  })

  test('F-2003 A10 맞춤 — 이동·회전·축소를 전부 되돌린다', async ({ page }) => {
    const { map, H, cx, cy } = await openMapFresh(page)
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.55 * H, 0, 'left')
    await drag(page, cx - 0.3 * H, cy, 0.5 * H, 0, 'right')
    await page.mouse.move(cx, cy)
    await page.mouse.wheel(0, 1200)
    await page.waitForTimeout(SETTLE)

    await map.getByRole('button', { name: '맞춤', exact: true }).click()
    await page.waitForTimeout(SETTLE)

    // 원래 크기·원래 자리로 돌아왔다
    await page.mouse.click(cx + NODE_R * 0.76 * H, cy)
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
  })

  test('F-2003 A13 이어서 조작해도 오류가 없다', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))

    const { map, H, cx, cy } = await openMapFresh(page)
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.55 * H, 0, 'left')
    await drag(page, cx - 0.3 * H, cy, 0.5 * H, 0, 'right')
    await page.mouse.move(cx, cy)
    await page.mouse.wheel(0, 1200)
    await page.waitForTimeout(SETTLE)

    await expect(map.locator('canvas')).toHaveCount(1)
    expect(errors).toEqual([])
  })
})

test.describe('F-2003 터치', () => {
  test.use({ reducedMotion: 'reduce', hasTouch: true })

  test('F-2003 A11 길게 누르기 — 메뉴가 뜨고 손가락을 떼도 남는다', async ({ page }) => {
    const { map, cx, cy } = await openMapFresh(page)
    const client = await page.context().newCDPSession(page)

    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] })
    await page.waitForTimeout(700)
    await expect(nodeMenu(map)).toBeVisible()

    // touchend 에서 preventDefault 를 안 하면 호환 mousedown 이 방금 연 메뉴를 닫는다 (F-2003 5.3)
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(nodeMenu(map)).toBeVisible()
  })

  test('F-2003 A12 짧게 누르기 — 메뉴 없이 그 문서가 열린다', async ({ page }) => {
    const { map, cx, cy } = await openMapFresh(page)
    const client = await page.context().newCDPSession(page)

    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] })
    await page.waitForTimeout(150)
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
    await expect(map).toHaveCount(0)
  })
})

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

test.describe('F-2004 노드 표현', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2004 A1 호버 이름표', async ({ page }) => {
    const { map, cx, cy } = await openMapFresh(page)
    await expect(visibleLabels(map)).toHaveCount(0)

    await page.mouse.move(cx, cy)
    await expect(visibleLabels(map)).toHaveCount(1)
    await expect(visibleLabels(map)).toHaveText(['사용법'])
  })

  test('F-2004 A2 호버를 풀면 사라진다', async ({ page }) => {
    const { map, H, cx, cy } = await openMapFresh(page)
    await page.mouse.move(cx, cy)
    await expect(visibleLabels(map)).toHaveCount(1)

    // 노드 밖 — 배경이다
    await page.mouse.move(cx + 0.45 * H, cy + 0.42 * H)
    await expect(visibleLabels(map)).toHaveCount(0)

    // 캔버스 밖으로 나가면 pointerleave 가 거둔다
    await page.mouse.move(cx, cy)
    await expect(visibleLabels(map)).toHaveCount(1)
    await map.locator('.map-page-title').hover()
    await expect(visibleLabels(map)).toHaveCount(0)
  })

  test('F-2004 A3 이름표가 카메라를 따라온다', async ({ page }) => {
    const { map, H, cx, cy } = await openMapFresh(page)
    await page.mouse.move(cx, cy)
    await expect(visibleLabels(map)).toHaveCount(1)
    const before = await labelBox(map, '사용법')

    // 노드 위에서 끌기 시작한다 — 배경에서 시작하면 그 첫 이동이 호버를 먼저 푼다
    await drag(page, cx, cy, 0.25 * H, 0, 'left')
    await page.waitForTimeout(SETTLE)

    const after = await labelBox(map, '사용법')
    const moved = after.x + after.width / 2 - (before.x + before.width / 2)
    expect(Math.abs(moved - 0.25 * H)).toBeLessThanOrEqual(8)
  })

  test('F-2004 A4 이름표가 클릭을 가로채지 않는다', async ({ page }) => {
    const { map, cx, cy } = await openMapFresh(page)
    await page.mouse.move(cx, cy)
    await expect(visibleLabels(map)).toHaveCount(1)

    // 이름표 한가운데에서 잡히는 요소가 캔버스여야 한다 — pointer-events: none 이 아니면 span 이 잡힌다
    const box = await labelBox(map, '사용법')
    const atLabel = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.className ?? '',
      [box.x + box.width / 2, box.y + box.height / 2],
    )
    expect(atLabel).toContain('map-canvas')

    // 레이어가 캔버스를 통째로 덮고 있어도 클릭이 지나간다
    await page.mouse.click(cx, cy)
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
  })
})

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

  test('F-2004 A6 끊긴 링크 노드 메뉴', async ({ page }) => {
    const view = await openMapWithDocs(page, [{ name: 'A.md', content: 'A\n\n[[없는 제목]]' }])
    await hoverUntil(page, view.map, view, (n) => n >= 1)
    await expect(visibleLabels(view.map)).toHaveCount(2)

    const spot = await findNodeAboveLabel(page, view.map, '없는 제목')
    await page.mouse.click(spot.x, spot.y, { button: 'right' })

    const items = nodeMenu(view.map).getByRole('menuitem')
    await expect(items).toHaveCount(1)
    await expect(items.first()).toHaveText('이 제목으로 새 문서')
  })

  test('F-2004 A7 이 제목으로 새 문서', async ({ page }) => {
    const view = await openMapWithDocs(page, [{ name: 'A.md', content: 'A\n\n[[없는 제목]]' }])
    await hoverUntil(page, view.map, view, (n) => n >= 1)
    const spot = await findNodeAboveLabel(page, view.map, '없는 제목')
    await page.mouse.click(spot.x, spot.y, { button: 'right' })
    await nodeMenu(view.map).getByRole('menuitem', { name: '이 제목으로 새 문서' }).click()

    await expect(page.locator('.doc-title')).toHaveValue('없는 제목')
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(page.locator('.map-page')).toHaveCount(0)
  })

  test('F-2004 A8 문서 노드 메뉴는 그대로 셋', async ({ page }) => {
    const view = await openMapWithDocs(page, [
      { name: 'B.md', content: 'B 문서' },
      { name: 'A.md', content: 'A\n\n[[B]]' },
    ])
    await hoverUntil(page, view.map, view, (n) => n >= 1)
    const spot = await findNodeAboveLabel(page, view.map, 'B')
    await page.mouse.click(spot.x, spot.y, { button: 'right' })

    const items = nodeMenu(view.map).getByRole('menuitem')
    await expect(items).toHaveCount(3)
    await expect(items.nth(0)).toHaveText('열기')
    await expect(items.nth(2)).toHaveText('여기로 이동')
  })
})

test.describe('F-2004 이어서 조작', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2004 A9 호버·회전을 이어서 해도 오류가 없다', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))

    const { map, H, cx, cy } = await openMapFresh(page)
    await page.mouse.move(cx, cy)
    await expect(visibleLabels(map)).toHaveCount(1)
    await drag(page, cx, cy, 0.5 * H, 0, 'right')
    await page.mouse.wheel(0, 1200)
    await page.waitForTimeout(SETTLE)
    await page.mouse.move(cx, cy)
    await page.waitForTimeout(SETTLE)

    await expect(map.locator('canvas')).toHaveCount(1)
    expect(errors).toEqual([])
  })
})

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

test.describe('F-2005 지도 설정 패널', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2005 A1 패널 여닫기', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const btn = map.getByRole('button', { name: '지도 설정', exact: true })

    await btn.click()
    await expect(panel(map)).toBeVisible()
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    await expect(map).toBeVisible()
    await expect(map.locator('canvas')).toHaveCount(1)

    await btn.click()
    await expect(panel(map)).toHaveCount(0)
    await expect(btn).toHaveAttribute('aria-expanded', 'false')
    await expect(map).toBeVisible()
    await expect(map.locator('canvas')).toHaveCount(1)
  })

  test('F-2005 A2 Esc 는 패널만 닫는다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    await openPanel(map)

    await page.keyboard.press('Escape')

    await expect(panel(map)).toHaveCount(0)
    await expect(map).toBeVisible()
    await expect(page).toHaveURL(/#\/map$/)
    await expect(map.getByRole('button', { name: '지도 설정', exact: true })).toBeFocused()
  })

  test('F-2005 A3 묶음은 표시 하나', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openPanel(map)

    await expect(p.locator('.map-panel-section')).toHaveCount(1)
    await expect(p.locator('.map-panel-section-head')).toHaveText('표시')
    for (const name of ['필터', '그룹', '장력']) {
      await expect(p.getByRole('button', { name, exact: true })).toHaveCount(0)
    }
    await expect(p.getByRole('button', { name: '표시', exact: true })).toHaveAttribute('aria-expanded', 'true')
  })

  test('F-2005 A4 슬라이더 셋과 기본값', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openPanel(map)

    const nodeScale = p.getByRole('slider', { name: '노드 크기', exact: true })
    const labelDistance = p.getByRole('slider', { name: '이름표 표시 거리', exact: true })
    const edgeStrength = p.getByRole('slider', { name: '선 두께', exact: true })
    await expect(nodeScale).toHaveCount(1)
    await expect(labelDistance).toHaveCount(1)
    await expect(edgeStrength).toHaveCount(1)
    expect(await nodeScale.inputValue()).toBe('1')
    expect(await labelDistance.inputValue()).toBe('0')
    expect(await edgeStrength.inputValue()).toBe('0.5')
  })

  test('F-2005 A5 값이 남는다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openPanel(map)
    await p.getByRole('slider', { name: '노드 크기', exact: true }).fill('2.5')

    await map.getByRole('button', { name: '닫기', exact: true }).click()
    await page.goto('/#/map')
    const map2 = page.locator('.map-page')
    await expect(map2).toBeVisible()
    const p2 = await openPanel(map2)

    expect(await p2.getByRole('slider', { name: '노드 크기', exact: true }).inputValue()).toBe('2.5')
  })

  test('F-2005 A6 세 축이 다 남는다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openPanel(map)
    await p.getByRole('slider', { name: '이름표 표시 거리', exact: true }).fill('0.4')
    await p.getByRole('slider', { name: '선 두께', exact: true }).fill('0.9')

    await map.getByRole('button', { name: '닫기', exact: true }).click()
    await page.goto('/#/map')
    const map2 = page.locator('.map-page')
    await expect(map2).toBeVisible()
    const p2 = await openPanel(map2)

    expect(await p2.getByRole('slider', { name: '이름표 표시 거리', exact: true }).inputValue()).toBe('0.4')
    expect(await p2.getByRole('slider', { name: '선 두께', exact: true }).inputValue()).toBe('0.9')
  })

  test('F-2005 A7 기본값으로', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openPanel(map)
    await p.getByRole('slider', { name: '노드 크기', exact: true }).fill('2')
    await p.getByRole('slider', { name: '이름표 표시 거리', exact: true }).fill('0.6')
    await p.getByRole('slider', { name: '선 두께', exact: true }).fill('0.1')

    await p.getByRole('button', { name: '기본값으로', exact: true }).click()

    expect(await p.getByRole('slider', { name: '노드 크기', exact: true }).inputValue()).toBe('1')
    expect(await p.getByRole('slider', { name: '이름표 표시 거리', exact: true }).inputValue()).toBe('0')
    expect(await p.getByRole('slider', { name: '선 두께', exact: true }).inputValue()).toBe('0.5')

    await map.getByRole('button', { name: '닫기', exact: true }).click()
    await page.goto('/#/map')
    const map2 = page.locator('.map-page')
    await expect(map2).toBeVisible()
    const p2 = await openPanel(map2)
    expect(await p2.getByRole('slider', { name: '노드 크기', exact: true }).inputValue()).toBe('1')
    expect(await p2.getByRole('slider', { name: '이름표 표시 거리', exact: true }).inputValue()).toBe('0')
    expect(await p2.getByRole('slider', { name: '선 두께', exact: true }).inputValue()).toBe('0.5')
  })

  test('F-2005 A8 깨진 저장값', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await setPrefBeforeLoad(page, 'md.mapView', '{{{')

    const { map } = await openMapFresh(page)
    const p = await openPanel(map)

    expect(await p.getByRole('slider', { name: '노드 크기', exact: true }).inputValue()).toBe('1')
    expect(await p.getByRole('slider', { name: '이름표 표시 거리', exact: true }).inputValue()).toBe('0')
    expect(await p.getByRole('slider', { name: '선 두께', exact: true }).inputValue()).toBe('0.5')
    expect(errors).toEqual([])
  })

  test('F-2005 A9 목록으로 가면 사라진다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    await openPanel(map)

    await map.getByRole('button', { name: '목록', exact: true }).click()
    await expect(map.getByRole('button', { name: '지도 설정', exact: true })).toHaveCount(0)
    await expect(map.locator('.map-panel')).toHaveCount(0)

    await map.getByRole('button', { name: '지도', exact: true }).click()
    await expect(map.getByRole('button', { name: '지도 설정', exact: true })).toBeVisible()
    await expect(map.locator('.map-panel')).toHaveCount(0)
  })

  test('F-2005 A10 WebGL 없음', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (typeof type === 'string' && type.startsWith('webgl')) return null
        return original.call(this, type, ...rest)
      }
    })
    await openApp(page)
    const map = await openMap(page)

    await expect(map.getByRole('button', { name: '지도 설정', exact: true })).toHaveCount(0)
  })

  test('F-2005 A11 패널이 캔버스를 줄이지 않는다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const before = await map.locator('.map-canvas').boundingBox()

    await openPanel(map)
    const after = await map.locator('.map-canvas').boundingBox()

    expect(after.width).toBe(before.width)
    expect(after.height).toBe(before.height)
  })

  test('F-2005 A12 슬라이더를 움직여도 안 깨진다', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    const { map, cx, cy } = await openMapFresh(page)
    const p = await openPanel(map)

    const nodeScale = p.getByRole('slider', { name: '노드 크기', exact: true })
    await nodeScale.fill('0.5')
    await nodeScale.fill('3')
    await nodeScale.fill('1.4')
    const edgeStrength = p.getByRole('slider', { name: '선 두께', exact: true })
    await edgeStrength.fill('0')
    await edgeStrength.fill('1')

    await expect(map.locator('canvas')).toHaveCount(1)
    expect(errors).toEqual([])

    await map.getByRole('button', { name: '지도 설정', exact: true }).click()
    await expect(panel(map)).toHaveCount(0)
    await page.mouse.click(cx, cy)
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
  })

  test('F-2005 A13 이름표 표시 거리', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openPanel(map)
    await expect(visibleLabels(map)).toHaveCount(0)

    await p.getByRole('slider', { name: '이름표 표시 거리', exact: true }).fill('1')
    await expect(visibleLabels(map)).toHaveCount(1)
    await expect(visibleLabels(map)).toHaveText(['사용법'])

    await p.getByRole('slider', { name: '이름표 표시 거리', exact: true }).fill('0')
    await expect(visibleLabels(map)).toHaveCount(0)
  })
})
