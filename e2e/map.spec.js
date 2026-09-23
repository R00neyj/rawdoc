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

  // 2026-09-22 사용자 신고 둘 — 명세에 없던 기준이라 F-2003 명세도 손봐야 한다
  test('F-2003 A14 이미 중심인 문서에 `여기로 이동` 을 다시 골라도 카메라가 맞춰진다', async ({ page }) => {
    const { map, H, cx, cy } = await openMapFresh(page)
    await page.mouse.click(cx, cy, { button: 'right' })
    await nodeMenu(map).getByRole('menuitem', { name: '여기로 이동' }).click()
    await expect(page).toHaveURL(/#\/map\/[^/]+$/)
    await page.waitForTimeout(SETTLE)

    // 이동으로 노드를 한쪽으로 밀어낸 뒤 같은 문서에 다시 `여기로 이동`
    await drag(page, cx, cy, 0.55 * H, 0, 'left')
    await page.waitForTimeout(SETTLE)
    await page.mouse.click(cx + 0.55 * H, cy, { button: 'right' })
    await nodeMenu(map).getByRole('menuitem', { name: '여기로 이동' }).click()
    await page.waitForTimeout(SETTLE)

    await page.mouse.click(cx, cy)
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
  })

  test('F-2003 A15 노드 위에서만 커서가 손가락 모양이다', async ({ page }) => {
    const { map, H, cx, cy } = await openMapFresh(page)
    const canvas = map.locator('canvas')
    await page.mouse.move(cx, cy)
    await expect(canvas).toHaveCSS('cursor', 'pointer')
    await page.mouse.move(cx + 0.45 * H, cy + 0.42 * H)
    await expect(canvas).toHaveCSS('cursor', 'auto')
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

  test('F-2005 A3 묶음은 표시·장력 둘', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openPanel(map)

    await expect(p.locator('.map-panel-section')).toHaveCount(2)
    await expect(p.locator('.map-panel-section-head')).toHaveText(['표시', '장력'])
    for (const name of ['필터', '그룹']) {
      await expect(p.getByRole('button', { name, exact: true })).toHaveCount(0)
    }
    await expect(p.getByRole('button', { name: '표시', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await expect(p.getByRole('button', { name: '장력', exact: true })).toHaveAttribute('aria-expanded', 'false')
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

// F-2006 지도 설정 패널 `장력` 4축 (specs/features/F-2006.md 14.2) A1~A11 — 캔버스 안은 못 보므로 슬라이더가 시뮬레이션에 닿았는지는 이름표 DOM 의 화면 좌표와 노드 클릭 적중으로만 판정한다
const FORCE_NAMES = ['중심 장력', '반발력', '링크 장력', '링크 거리']
// MAP_FORCE_AXES 의 start 를 forceValueToNorm 으로 되돌린 값 (F-2006 4.7)
const FORCE_DEFAULTS = {
  '중심 장력': 0.4345879896760937,
  반발력: 0.6771752303951257,
  '링크 장력': 0.5410205792797051,
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

function forceSlider(p, name) {
  return p.getByRole('slider', { name, exact: true })
}

test.describe('F-2006 장력 묶음', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2006 A1 장력 묶음이 표시 아래에 접힌 채 생긴다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openPanel(map)

    await expect(p.locator('.map-panel-section')).toHaveCount(2)
    await expect(p.locator('.map-panel-section-head')).toHaveText(['표시', '장력'])
    await expect(p.getByRole('button', { name: '표시', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await expect(p.getByRole('button', { name: '장력', exact: true })).toHaveAttribute('aria-expanded', 'false')
    for (const name of ['필터', '그룹']) {
      await expect(p.getByRole('button', { name, exact: true })).toHaveCount(0)
    }
  })

  test('F-2006 A2 펼치면 슬라이더 넷', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openPanel(map)

    // 접힌 동안에는 hidden 안이라 접근성 트리에 없다
    for (const name of FORCE_NAMES) await expect(forceSlider(p, name)).toHaveCount(0)

    await p.getByRole('button', { name: '장력', exact: true }).click()

    await expect(p.getByRole('button', { name: '장력', exact: true })).toHaveAttribute('aria-expanded', 'true')
    for (const name of FORCE_NAMES) await expect(forceSlider(p, name)).toHaveCount(1)
  })

  test('F-2006 A3 기본값', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openForce(map)

    for (const name of FORCE_NAMES) {
      // step="any" 라 브라우저가 눈금에 스냅하지 않는다 (F-2006 7.3)
      expect(Number(await forceSlider(p, name).inputValue())).toBeCloseTo(FORCE_DEFAULTS[name], 6)
    }
  })

  test('F-2006 A4 값이 남는다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openForce(map)
    await forceSlider(p, '반발력').fill('0.9')
    await forceSlider(p, '링크 거리').fill('0.6')

    await map.getByRole('button', { name: '닫기', exact: true }).click()
    await page.goto('/#/map')
    const map2 = page.locator('.map-page')
    await expect(map2).toBeVisible()
    const p2 = await openForce(map2)

    expect(await forceSlider(p2, '반발력').inputValue()).toBe('0.9')
    expect(await forceSlider(p2, '링크 거리').inputValue()).toBe('0.6')
  })

  test('F-2006 A5 기본값으로가 장력도 되돌린다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openForce(map)
    await forceSlider(p, '중심 장력').fill('0.1')
    await forceSlider(p, '반발력').fill('0.95')
    await forceSlider(p, '링크 장력').fill('0.2')
    await forceSlider(p, '링크 거리').fill('0.8')
    await p.getByRole('slider', { name: '노드 크기', exact: true }).fill('2')

    await p.getByRole('button', { name: '기본값으로', exact: true }).click()

    for (const name of FORCE_NAMES) {
      expect(Number(await forceSlider(p, name).inputValue())).toBeCloseTo(FORCE_DEFAULTS[name], 6)
    }
    expect(await p.getByRole('slider', { name: '노드 크기', exact: true }).inputValue()).toBe('1')

    await map.getByRole('button', { name: '닫기', exact: true }).click()
    await page.goto('/#/map')
    const map2 = page.locator('.map-page')
    await expect(map2).toBeVisible()
    const p2 = await openForce(map2)
    for (const name of FORCE_NAMES) {
      expect(Number(await forceSlider(p2, name).inputValue())).toBeCloseTo(FORCE_DEFAULTS[name], 6)
    }
  })

  test('F-2006 A6 깨진 저장값', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await setPrefBeforeLoad(page, 'md.mapView', '{"force":{"repel":"x","zzz":1,"center":9}}')

    const { map } = await openMapFresh(page)
    const p = await openForce(map)

    // 문자열은 버려 기본값, 모르는 키는 버림, 유한수 9 는 1 로 잘린다
    expect(Number(await forceSlider(p, '반발력').inputValue())).toBeCloseTo(FORCE_DEFAULTS['반발력'], 6)
    expect(Number(await forceSlider(p, '링크 장력').inputValue())).toBeCloseTo(FORCE_DEFAULTS['링크 장력'], 6)
    expect(Number(await forceSlider(p, '링크 거리').inputValue())).toBeCloseTo(FORCE_DEFAULTS['링크 거리'], 6)
    expect(Number(await forceSlider(p, '중심 장력').inputValue())).toBe(1)
    expect(errors).toEqual([])
  })

  test('F-2006 A7 끝에서 끝까지 움직여도 안 깨진다', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    const { map, cx, cy } = await openMapFresh(page)
    const p = await openForce(map)

    for (const name of FORCE_NAMES) {
      const slider = forceSlider(p, name)
      await slider.fill('0')
      await slider.fill('1')
      // 브라우저가 17자리를 15자리로 줄여 되돌리므로 fill 에는 기본값 근처의 짧은 수를 쓴다
      await slider.fill(FORCE_DEFAULTS[name].toFixed(3))
    }

    await expect(map.locator('canvas')).toHaveCount(1)
    expect(errors).toEqual([])

    await map.getByRole('button', { name: '지도 설정', exact: true }).click()
    await expect(panel(map)).toHaveCount(0)
    await page.waitForTimeout(FORCE_SETTLE)
    await page.mouse.click(cx, cy)
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
  })

  test('F-2006 A8 놓으면 카메라가 다시 맞는다', async ({ page }) => {
    const { map, H, cx, cy } = await openMapFresh(page)
    await page.mouse.move(cx, cy)
    // 12칸 축소 = 화면 반지름 0.394H → 0.213H. 0.76 자리는 이제 빗나간다 (F-2003 A9 와 같은 통로)
    await page.mouse.wheel(0, 1200)
    await page.waitForTimeout(SETTLE)
    await page.mouse.click(cx + NODE_R * 0.76 * H, cy)
    await expect(page).toHaveURL(/#\/map$/)

    const p = await openForce(map)
    // fill 은 input 과 change 를 한 번씩 쏜다 — change 가 곧 "놓았다"다 (F-2006 6.4)
    await forceSlider(p, '반발력').fill('0.7')
    await page.waitForTimeout(SETTLE)
    await map.getByRole('button', { name: '지도 설정', exact: true }).click()
    await expect(panel(map)).toHaveCount(0)

    await page.mouse.click(cx + NODE_R * 0.76 * H, cy)
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
  })

  test('F-2006 A9 장력은 접힌 채로 다시 열린다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    await openForce(map)

    await map.getByRole('button', { name: '지도 설정', exact: true }).click()
    await expect(panel(map)).toHaveCount(0)
    const p2 = await openPanel(map)

    await expect(p2.getByRole('button', { name: '장력', exact: true })).toHaveAttribute('aria-expanded', 'false')
  })

  test('F-2006 A10 방향키로도 움직이고 저장된다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openForce(map)
    const slider = forceSlider(p, '반발력')
    const before = Number(await slider.inputValue())

    await slider.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')

    const after = Number(await slider.inputValue())
    expect(after - before).toBeCloseTo(0.03, 6)

    await map.getByRole('button', { name: '닫기', exact: true }).click()
    await page.goto('/#/map')
    const map2 = page.locator('.map-page')
    await expect(map2).toBeVisible()
    const p2 = await openForce(map2)
    expect(Number(await forceSlider(p2, '반발력').inputValue())).toBeCloseTo(after, 6)
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

    // 실측 301.1 px → 543.9 px (1.81배). 1.2 문턱은 그 아래로 50% 여유다 (F-2006 14.2)
    await expect.poll(async () => (await gap()) / before, { timeout: FORCE_SETTLE + 4000 }).toBeGreaterThan(1.2)
  })
})

// F-2010 호버 초점 (specs/features/F-2010.md 12.2) A1~A7 — 캔버스 픽셀은 preserveDrawingBuffer 가 없어 페이지 안에서 못 읽는다. Playwright 요소 스크린샷만 WebGL 내용을 잡는다
async function canvasShot(map) {
  return (await map.locator('.map-canvas').screenshot()).toString('base64')
}

// PNG 디코드는 브라우저에 되맡긴다 — 새 의존성을 깔지 않으려는 것이다
async function comparePng(page, a, b) {
  return page.evaluate(async ([p, q]) => {
    const load = async (b64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      return ctx.getImageData(0, 0, c.width, c.height)
    }
    // 그 그림에서 가장 많이 나온 색(= 배경)과의 채널별 최대 거리의 전체 평균. 배경색 hex 를 테스트에 적지 않으려는 것이다
    const inkMean = (img) => {
      const counts = new Map()
      for (let i = 0; i < img.data.length; i += 4) {
        const key = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      let bg = 0
      let best = -1
      for (const [k, v] of counts) if (v > best) { best = v; bg = k }
      const br = (bg >> 16) & 255
      const bgc = (bg >> 8) & 255
      const bb = bg & 255
      let sum = 0
      for (let i = 0; i < img.data.length; i += 4) {
        sum += Math.max(Math.abs(img.data[i] - br), Math.abs(img.data[i + 1] - bgc), Math.abs(img.data[i + 2] - bb))
      }
      return sum / (img.data.length / 4)
    }
    const A = await load(p)
    const B = await load(q)
    const n = Math.min(A.data.length, B.data.length)
    let diff8 = 0
    let maxDiff = 0
    for (let i = 0; i < n; i += 4) {
      const d = Math.max(
        Math.abs(A.data[i] - B.data[i]),
        Math.abs(A.data[i + 1] - B.data[i + 1]),
        Math.abs(A.data[i + 2] - B.data[i + 2]),
      )
      if (d > maxDiff) maxDiff = d
      if (d > 8) diff8 += 1
    }
    return { pctDiff8: (diff8 / (n / 4)) * 100, maxDiff, inkMeanA: inkMean(A), inkMeanB: inkMean(B) }
  }, [a, b])
}

// hoverUntil 은 마우스를 옮긴 직후 이름표 수를 보는데 이름표는 React 커밋 뒤에야 붙는다 — 파일 전체를 돌릴 때는 그 한 박자에 노드를 지나쳐 버린다. 판정이 아니라 준비 단계라 다시 훑는다
async function hoverNode(page, view) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await settleFrames(page)
    try {
      return await hoverUntil(page, view.map, view, (n) => n >= 1)
    } catch {
      // 캔버스 밖으로 빼 호버를 비우고 다시 훑는다
      await view.map.locator('.map-page-title').hover()
      await page.waitForTimeout(300)
    }
  }
  throw new Error('hoverNode: 세 번 훑어도 노드를 못 찾았다')
}

// 렌더 루프는 스스로 멈추므로 프레임을 두 번 기다려 그림이 자리 잡은 뒤에 찍는다
async function settleFrames(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))
}

// 노드 하나짜리 첫 실행 상태에서는 흐릴 대상이 없다 — 문서 12개, 문서마다 링크 2개로 고정한다 (F-2010 12.2)
const FOCUS_N = 24
const FOCUS_DOCS = Array.from({ length: FOCUS_N }, (_, i) => {
  const n = i + 1
  const a = (n % FOCUS_N) + 1
  const b = ((n + 1) % FOCUS_N) + 1
  return { name: `D${n}.md`, content: `D${n}\n\n[[D${a}]] [[D${b}]]` }
})

test.describe('F-2010 호버 초점', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2010 A1 노드에 호버하면 캔버스 그림이 크게 바뀐다', async ({ page }) => {
    const view = await openMapWithDocs(page, FOCUS_DOCS)
    await settleFrames(page)
    const before = await canvasShot(view.map)

    await hoverNode(page, view)
    await settleFrames(page)
    const after = await canvasShot(view.map)

    // 구현 전 실측 0.073%(이름표 DOM 뿐), 구현 뒤 2.09~2.11%. 1.0% 문턱은 양쪽에서 2배 넘게 떨어져 있다
    const { pctDiff8 } = await comparePng(page, before, after)
    expect(pctDiff8).toBeGreaterThanOrEqual(1.0)
  })

  test('F-2010 A2 호버를 풀면 호버 전 그림으로 돌아온다', async ({ page }) => {
    const view = await openMapWithDocs(page, FOCUS_DOCS)
    await settleFrames(page)
    const before = await canvasShot(view.map)

    await hoverNode(page, view)
    await settleFrames(page)

    // 캔버스 밖으로 나가면 pointerleave 가 거둔다 — 카메라는 그대로다 (F-2010 8.1)
    await view.map.locator('.map-page-title').hover()
    await expect(visibleLabels(view.map)).toHaveCount(0)
    await settleFrames(page)
    const back = await canvasShot(view.map)

    const { pctDiff8 } = await comparePng(page, before, back)
    expect(pctDiff8).toBeLessThanOrEqual(0.1)
  })

  test('F-2010 A3 호버 중에는 그림이 배경 쪽으로 가라앉는다', async ({ page }) => {
    const view = await openMapWithDocs(page, FOCUS_DOCS)
    await settleFrames(page)
    const before = await canvasShot(view.map)

    await hoverNode(page, view)
    await settleFrames(page)
    const during = await canvasShot(view.map)

    // 실측 0.365배(혼자 8/8), 파일 전체를 돌리면 hoverUntil 이 다른 노드에 앉아 0.617배까지 뜬다. 흐리기를 끄면 1.15배로 오히려 오르므로 0.85 문턱이 그 사이다
    const { inkMeanA, inkMeanB } = await comparePng(page, before, during)
    expect(inkMeanB).toBeLessThanOrEqual(inkMeanA * 0.85)
  })

  test('F-2010 A4 흐리기가 이름표를 바꾸지 않는다', async ({ page }) => {
    const view = await openMapWithDocs(page, [
      { name: 'B.md', content: 'B 문서' },
      { name: 'A.md', content: 'A\n\n[[B]]' },
    ])
    await hoverNode(page, view)

    await expect(visibleLabels(view.map)).toHaveCount(2)
    const texts = await visibleLabels(view.map).allTextContents()
    expect(texts.slice().sort()).toEqual(['A', 'B'])
  })

  test('F-2010 A5 회전하는 내내 강조가 유지된다', async ({ page }) => {
    const view = await openMapWithDocs(page, FOCUS_DOCS)
    const spot = await hoverNode(page, view)

    // 호버한 노드 위에서 끌기 시작한다 — 배경에서 시작하면 그 첫 이동이 호버를 먼저 푼다
    await drag(page, spot.x, spot.y, 0.25 * view.H, 0, 'right')
    await page.waitForTimeout(SETTLE)
    await expect(visibleLabels(view.map)).not.toHaveCount(0)
    await settleFrames(page)
    const hovered = await canvasShot(view.map)

    // 카메라를 건드리지 않고 호버만 푼다 — 같은 각도의 호버 없음 그림이다
    await view.map.locator('.map-page-title').hover()
    await expect(visibleLabels(view.map)).toHaveCount(0)
    await settleFrames(page)
    const plain = await canvasShot(view.map)

    // 실측 2.11%. 구현 전에는 같은 자리가 0.073% 였다
    const { pctDiff8 } = await comparePng(page, hovered, plain)
    expect(pctDiff8).toBeGreaterThanOrEqual(1.0)
  })

  test('F-2010 A6 호버·회전·슬라이더를 이어서 해도 안 깨진다', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))

    const view = await openMapWithDocs(page, FOCUS_DOCS)
    const spot = await hoverNode(page, view)
    await drag(page, spot.x, spot.y, 0.3 * view.H, 0.1 * view.H, 'right')
    await page.waitForTimeout(SETTLE)

    const p = await openPanel(view.map)
    await p.getByRole('slider', { name: '선 두께', exact: true }).fill('0')
    await p.getByRole('slider', { name: '선 두께', exact: true }).fill('1')
    await view.map.getByRole('button', { name: '지도 설정', exact: true }).click()
    await expect(panel(view.map)).toHaveCount(0)

    await expect(view.map.locator('canvas')).toHaveCount(1)
    expect(errors).toEqual([])

    // 회전한 뒤에는 덩어리가 hoverUntil 의 탐색 반지름 밖으로 나갈 수 있다 — 먼저 카메라를 다시 맞춘다
    await view.map.getByRole('button', { name: '맞춤', exact: true }).click()
    await page.waitForTimeout(SETTLE)
    const again = await hoverNode(page, view)
    await page.mouse.click(again.x, again.y)
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
  })

  test('F-2010 A7 선 두께가 정점 색으로 옮겨 가도 계속 동작한다', async ({ page }) => {
    const view = await openMapWithDocs(page, FOCUS_DOCS)
    const p = await openPanel(view.map)
    const edgeStrength = p.getByRole('slider', { name: '선 두께', exact: true })

    await edgeStrength.fill('0')
    await settleFrames(page)
    const thin = await canvasShot(view.map)

    await edgeStrength.fill('1')
    await settleFrames(page)
    const thick = await canvasShot(view.map)

    // 실측 1.75%. 간선만으로도 먹 덮개의 상당 부분이다. 6.4 의 회귀 방지다
    const { pctDiff8 } = await comparePng(page, thin, thick)
    expect(pctDiff8).toBeGreaterThanOrEqual(0.3)
  })
})
