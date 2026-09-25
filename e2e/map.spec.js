// 위키링크 지도 3D 판 (specs/features/F-2002.md 12.2) A1~A16 — 캔버스 안의 좌표·색·크기는 판정하지 않고, 노드 클릭 경로는 목록 통로로 판정한다 (F-292 11장)
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

  test('F-2003 A1 노드 우클릭 — 항목 넷짜리 메뉴', async ({ page }) => {
    const { map, cx, cy } = await openMapFresh(page)
    await page.mouse.click(cx, cy, { button: 'right' })

    const items = nodeMenu(map).getByRole('menuitem')
    await expect(items).toHaveCount(4)
    await expect(items.nth(0)).toHaveText('열기')
    await expect(items.nth(1)).toHaveText('새 탭에서 열기')
    await expect(items.nth(2)).toHaveText('여기로 이동')
    await expect(items.nth(3)).toHaveText('이어진 문서만 보기')
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

  // 2026-09-22 사용자 신고 둘 — 명세에 없던 기준이라 F-2003 명세도 손봐야 한다
  test('F-2003 A14 이미 중심인 문서에 `여기로 이동` 을 다시 골라도 카메라가 맞춰진다', async ({ page }) => {
    const { map, H, cx, cy } = await openMapFresh(page)
    await page.mouse.click(cx, cy, { button: 'right' })
    await nodeMenu(map).getByRole('menuitem', { name: '여기로 이동' }).click()
    await expect(page).toHaveURL(/#\/map\/[^/]+$/)
    await page.waitForTimeout(SETTLE)

    // 이동으로 노드를 한쪽으로 밀어낸 뒤 같은 문서에 다시 `여기로 이동`. 노드 위에서 시작하면 노드 끌기가 된다 — F-2009
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.55 * H, 0, 'left')
    await page.waitForTimeout(SETTLE)
    await page.mouse.click(cx + 0.55 * H, cy, { button: 'right' })
    await nodeMenu(map).getByRole('menuitem', { name: '여기로 이동' }).click()
    await page.waitForTimeout(SETTLE)

    await page.mouse.click(cx, cy)
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
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

    // 노드 위에서 끌면 노드 끌기가 되므로 배경에서 이동한 뒤 옮겨 간 자리에서 다시 호버한다 (F-2009 14장)
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.25 * H, 0, 'left')
    await page.waitForTimeout(SETTLE)
    await page.mouse.move(cx + 0.25 * H, cy)
    await expect(visibleLabels(map)).toHaveCount(1)

    const after = await labelBox(map, '사용법')
    expect(Math.abs(after.x + after.width / 2 - (cx + 0.25 * H))).toBeLessThanOrEqual(8)
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

  test('F-2004 A8 문서 노드 메뉴는 넷', async ({ page }) => {
    const view = await openMapWithDocs(page, [
      { name: 'B.md', content: 'B 문서' },
      { name: 'A.md', content: 'A\n\n[[B]]' },
    ])
    await hoverUntil(page, view.map, view, (n) => n >= 1)
    const spot = await findNodeAboveLabel(page, view.map, 'B')
    await page.mouse.click(spot.x, spot.y, { button: 'right' })

    const items = nodeMenu(view.map).getByRole('menuitem')
    await expect(items).toHaveCount(4)
    await expect(items.nth(0)).toHaveText('열기')
    await expect(items.nth(2)).toHaveText('여기로 이동')
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

  test('F-2005 A3 묶음은 필터·그룹·표시·장력 넷', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openPanel(map)

    await expect(p.locator('.map-panel-section')).toHaveCount(4)
    await expect(p.locator('.map-panel-section-head')).toHaveText(['필터', '그룹', '표시', '장력'])
    await expect(p.getByRole('button', { name: '필터', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await expect(p.getByRole('button', { name: '그룹', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect(p.getByRole('button', { name: '표시', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect(p.getByRole('button', { name: '장력', exact: true })).toHaveAttribute('aria-expanded', 'false')
  })

  test('F-2005 A4 슬라이더 셋과 기본값', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openDisplay(map)

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
    const p = await openDisplay(map)
    await p.getByRole('slider', { name: '노드 크기', exact: true }).fill('2.5')

    await map.getByRole('button', { name: '닫기', exact: true }).click()
    await page.goto('/#/map')
    const map2 = page.locator('.map-page')
    await expect(map2).toBeVisible()
    const p2 = await openDisplay(map2)

    expect(await p2.getByRole('slider', { name: '노드 크기', exact: true }).inputValue()).toBe('2.5')
  })

  test('F-2005 A6 세 축이 다 남는다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openDisplay(map)
    await p.getByRole('slider', { name: '이름표 표시 거리', exact: true }).fill('0.4')
    await p.getByRole('slider', { name: '선 두께', exact: true }).fill('0.9')

    await map.getByRole('button', { name: '닫기', exact: true }).click()
    await page.goto('/#/map')
    const map2 = page.locator('.map-page')
    await expect(map2).toBeVisible()
    const p2 = await openDisplay(map2)

    expect(await p2.getByRole('slider', { name: '이름표 표시 거리', exact: true }).inputValue()).toBe('0.4')
    expect(await p2.getByRole('slider', { name: '선 두께', exact: true }).inputValue()).toBe('0.9')
  })

  test('F-2005 A7 기본값으로', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openDisplay(map)
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
    const p2 = await openDisplay(map2)
    expect(await p2.getByRole('slider', { name: '노드 크기', exact: true }).inputValue()).toBe('1')
    expect(await p2.getByRole('slider', { name: '이름표 표시 거리', exact: true }).inputValue()).toBe('0')
    expect(await p2.getByRole('slider', { name: '선 두께', exact: true }).inputValue()).toBe('0.5')
  })

  // F-2005 A8 깨진 저장값("{{{")은 src/app/mapPrefs.test.ts U2 가 같은 입력·기대값으로 본다 (2026-09-25 e2e 경량화)

  test('F-2005 A9 목록으로 가도 패널이 남는다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    await openPanel(map)

    // 필터·그룹은 목록에도 반영되므로 두 보기에서 다 패널을 열 수 있다 (F-2007 11.3, F-2008 7.1)
    await map.getByRole('button', { name: '목록', exact: true }).click()
    await expect(map.getByRole('button', { name: '지도 설정', exact: true })).toBeVisible()
    await expect(panel(map)).toBeVisible()
    await expect(panel(map).locator('.map-panel-section')).toHaveCount(2)
    await expect(panel(map).locator('.map-panel-section-head')).toHaveText(['필터', '그룹'])

    await map.getByRole('button', { name: '지도', exact: true }).click()
    await expect(map.getByRole('button', { name: '지도 설정', exact: true })).toBeVisible()
    await expect(panel(map)).toBeVisible()
  })

  test('F-2005 A10 WebGL 없음 — 목록이 유일한 화면이라 필터가 필요하다', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (typeof type === 'string' && type.startsWith('webgl')) return null
        return original.call(this, type, ...rest)
      }
    })
    await openApp(page)
    const map = await openMap(page)

    await expect(map.getByRole('button', { name: '지도 설정', exact: true })).toHaveCount(1)
  })

  test('F-2005 A11 패널이 캔버스를 줄이지 않는다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const before = await map.locator('.map-canvas').boundingBox()

    await openPanel(map)
    const after = await map.locator('.map-canvas').boundingBox()

    expect(after.width).toBe(before.width)
    expect(after.height).toBe(before.height)
  })

  test('F-2005 A13 이름표 표시 거리', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openDisplay(map)
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
  '중심 장력': 0.6419391565964472,
  반발력: 0.6771752303951257,
  '링크 장력': 0.48430736193807317,
  '링크 거리': 0.17407765595569785,
}
// 장력 슬라이더가 일으킨 재가열은 reduced-motion 에서도 프레임마다 돈다 — 278 tick 이라 SETTLE 보다 오래 걸린다 (F-2006 5.2·9장)
const FORCE_SETTLE = 8000

// `필터` 가 생기면서 `표시` 는 접힌 채로 뜬다 — 슬라이더를 잡으려면 먼저 펼쳐야 한다 (F-2007 17.1)
async function openDisplay(map) {
  const p = await openPanel(map)
  await p.getByRole('button', { name: '표시', exact: true }).click()
  return p
}

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

test.describe('F-2006 장력 묶음', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2006 A1 장력 묶음이 표시 아래에 접힌 채 생긴다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openPanel(map)

    await expect(p.locator('.map-panel-section')).toHaveCount(4)
    await expect(p.locator('.map-panel-section-head')).toHaveText(['필터', '그룹', '표시', '장력'])
    await expect(p.getByRole('button', { name: '필터', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await expect(p.getByRole('button', { name: '그룹', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect(p.getByRole('button', { name: '표시', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect(p.getByRole('button', { name: '장력', exact: true })).toHaveAttribute('aria-expanded', 'false')
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
    // `필터` 가 첫 묶음이 되면서 `표시` 도 접힌다 — `노드 크기` 를 잡으려면 펼쳐야 한다 (F-2007 17.1)
    await p.getByRole('button', { name: '표시', exact: true }).click()
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
    // 장력 중에는 카메라가 안 맞으므로 A 가 화면 밖으로 나간다 — 멈춘 뒤 맞춤으로 되돌려 잰다 (F-2012 13.2)
    await page.waitForTimeout(FORCE_SETTLE)
    await view.map.getByRole('button', { name: '맞춤', exact: true }).click()

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

})

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

  test('F-2012 A2 움직임 줄이기면 한 번에 간다', async ({ page }) => {
    const { map, H, cx, cy } = await openMapLabeled(page)
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.55 * H, 0, 'left')
    await page.waitForTimeout(SETTLE)

    const recording = recordLabelX(page, 900)
    await map.getByRole('button', { name: '맞춤', exact: true }).click()
    const xs = await recording

    expect(distinctXs(xs)).toBeLessThanOrEqual(2)
    expect(Math.abs(xs.at(-1)[1] - cx)).toBeLessThanOrEqual(4)
  })

  // A4·A5 는 준비(휠로 물러나기 → 반발력 0.7 → 패널 닫기)가 같아 하나로 합쳤다 (2026-09-25 e2e 경량화)
  test('F-2012 A4·A5 장력을 바꿔도 카메라가 안 움직이고, 그 뒤 맞춤이 되돌린다', async ({ page }) => {
    const { map, H, cx, cy } = await openMapLabeled(page)
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

    // A5 — 맞춤이 되돌린다
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

// F-2011 지도 머리 줄 아이콘 버튼화 (specs/features/F-2011.md 9장) A1~A9
const HEAD_BUTTON_NAMES = ['지도', '목록', '맞춤', '지도 설정', '닫기']

function headButton(map, name) {
  return map.getByRole('button', { name, exact: true })
}

test.describe('F-2011 A1~A5 머리 줄 구조', () => {
  // A1~A5 다섯 테스트(글자 없음·svg 하나·제목 svg 없음·묶음·툴팁)를 한 번 열어 한꺼번에 본다 (2026-09-25 e2e 경량화)
  test('다섯 버튼 글자 없이 svg 하나·툴팁 = 이름, 제목은 글자만, 지도·목록만 묶음 안', async ({ page }) => {
    await openApp(page)
    const map = await openMap(page)
    for (const name of HEAD_BUTTON_NAMES) {
      const btn = headButton(map, name)
      await expect(btn).toHaveText('')
      await expect(btn.locator('svg')).toHaveCount(1)
      const wrap = btn.locator('xpath=..')
      await expect(wrap).toHaveClass(/\bicon-btn-wrap\b/)
      await expect(wrap.locator('.icon-tooltip')).toHaveText(name)
    }

    const title = map.locator('.map-page-title')
    await expect(title).toHaveText('지도')
    await expect(title.locator('svg')).toHaveCount(0)

    const seg = map.locator('.map-segment')
    await expect(seg).toHaveClass(/\bseg\b/)
    await expect(seg.getByRole('button')).toHaveCount(2)
    await expect(seg.getByRole('button', { name: '지도', exact: true })).toHaveCount(1)
    await expect(seg.getByRole('button', { name: '목록', exact: true })).toHaveCount(1)
  })
})

test.describe('F-2011 A6 눌러도 하던 일을 한다', () => {
  test('아이콘 버튼이 전과 같은 동작을 한다', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await openApp(page)
    const docId = await currentDocId(page)
    const map = await openMap(page)

    await headButton(map, '목록').click()
    await expect(map.locator('.map-list-group').first()).toBeVisible()
    // 목록 보기에서도 `지도 설정` 이 그려진다 — F-2007 이 F-2005 5.1 의 조건을 뒤집었다
    await expect(headButton(map, '지도 설정')).toBeVisible()

    await headButton(map, '지도').click()
    await expect(map.locator('canvas')).toHaveCount(1)

    await headButton(map, '맞춤').click()
    await expect(map.locator('canvas')).toHaveCount(1)

    await headButton(map, '지도 설정').click()
    await expect(map.locator('.map-panel')).toBeVisible()
    await headButton(map, '지도 설정').click()
    await expect(map.locator('.map-panel:not([inert])')).toHaveCount(0)

    await headButton(map, '닫기').click()
    await expect(map).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`#/d/${docId}$`))
    expect(errors).toEqual([])
  })
})

test.describe('F-2011 A7 선택 표시', () => {
  test('지도가 처음에 눌린 상태, 목록을 누르면 뒤집힌다', async ({ page }) => {
    await openApp(page)
    const map = await openMap(page)
    await expect(headButton(map, '지도')).toHaveAttribute('aria-pressed', 'true')
    await expect(headButton(map, '목록')).toHaveAttribute('aria-pressed', 'false')

    await headButton(map, '목록').click()
    await expect(headButton(map, '지도')).toHaveAttribute('aria-pressed', 'false')
    await expect(headButton(map, '목록')).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('F-2011 A8 WebGL2 없음', () => {
  test('지도 버튼이 aria-disabled 이고 안내 문구가 뜬다', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (typeof type === 'string' && type.startsWith('webgl')) return null
        return original.call(this, type, ...rest)
      }
    })
    await openApp(page)
    const map = await openMap(page)

    await expect(headButton(map, '지도')).toHaveAttribute('aria-disabled', 'true')
    await expect(map.locator('.map-notice')).toContainText('이 브라우저에서는 3D 지도를 그릴 수 없습니다.')
  })
})

test.describe('F-2011 A9 Esc 로는 안 닫힌다', () => {
  test('지도를 연 뒤 Escape 를 눌러도 지도가 그대로 보인다', async ({ page }) => {
    await openApp(page)
    await openMap(page)
    await page.keyboard.press('Escape')
    await expect(page.locator('.map-page')).toBeVisible()
    await expect(page).toHaveURL(/#\/map/)
  })
})

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

test.describe('F-2009 노드 끌기', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2009 A1 노드가 커서를 따라온다', async ({ page }) => {
    const { map, H, cx, cy } = await openMapFresh(page)
    await page.mouse.move(cx, cy)
    await expect(visibleLabels(map)).toHaveCount(1)

    await dragHeld(page, cx, cy, 0.55 * H, 0)
    expect(Math.abs((await labelCenterX(map)) - (cx + 0.55 * H))).toBeLessThanOrEqual(8)
    await page.mouse.up()
  })

  test('F-2009 A2 놓으면 제자리로 돌아온다', async ({ page }) => {
    const { H, cx, cy } = await openMapFresh(page)
    await dragHeld(page, cx, cy, 0.55 * H, 0)
    await page.mouse.up()
    await page.waitForTimeout(SETTLE)

    // 노드 하나짜리 그래프는 놓고 1 tick 만에 원점으로 돌아온다 (F-2009 6.4)
    await page.mouse.click(cx + 0.55 * H, cy)
    await expect(page).toHaveURL(/#\/map$/)
    await page.mouse.click(cx, cy)
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
  })

  test('F-2009 A3 살짝 움직였다 뗀 것은 클릭이다', async ({ page }) => {
    const { cx, cy } = await openMapFresh(page)
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 3, cy)
    await page.mouse.up()
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
  })

  test('F-2009 A4 메뉴가 떠 있으면 끌리지 않는다', async ({ page }) => {
    const { map, H, cx, cy } = await openMapFresh(page)
    await page.mouse.click(cx, cy, { button: 'right' })
    await expect(nodeMenu(map)).toBeVisible()

    await dragHeld(page, cx, cy, 0.55 * H, 0)
    expect(Math.abs((await labelCenterX(map)) - cx)).toBeLessThanOrEqual(8)
    await page.mouse.up()
    await expect(nodeMenu(map)).toHaveCount(0)
    await expect(page).toHaveURL(/#\/map$/)
  })

  test('F-2009 A5 배경 좌클릭 끌기는 그대로 이동이다', async ({ page }) => {
    const { H, cx, cy } = await openMapFresh(page)
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.55 * H, 0, 'left')
    await page.waitForTimeout(SETTLE)

    await page.mouse.click(cx, cy)
    await expect(page).toHaveURL(/#\/map$/)
    await page.mouse.click(cx + 0.55 * H, cy)
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

test.describe('F-2009 터치', () => {
  test.use({ reducedMotion: 'reduce', hasTouch: true })

  test('F-2009 A7 터치 한 손가락 노드 끌기', async ({ page }) => {
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
  })
})

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

test.describe('F-2007 지도 설정 패널 필터', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2007 A1 필터 가 맨 위에 펼쳐져 생기고 그룹 은 접힌 채 보인다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openPanel(map)

    await expect(p.locator('.map-panel-section')).toHaveCount(4)
    await expect(p.locator('.map-panel-section-head')).toHaveText(['필터', '그룹', '표시', '장력'])
    await expect(p.getByRole('button', { name: '필터', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await expect(p.getByRole('button', { name: '그룹', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect(p.getByRole('button', { name: '표시', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect(p.getByRole('button', { name: '장력', exact: true })).toHaveAttribute('aria-expanded', 'false')
  })

  test('F-2007 A2 다섯 항목', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openPanel(map)

    await expect(p.getByRole('searchbox', { name: '파일 검색' })).toHaveCount(1)
    const isolated = p.getByRole('checkbox', { name: '고립 문서' })
    const broken = p.getByRole('checkbox', { name: '끊긴 링크' })
    await expect(isolated).toHaveCount(1)
    await expect(isolated).toBeChecked()
    await expect(broken).toHaveCount(1)
    await expect(broken).toBeChecked()
    const hops = p.getByRole('slider', { name: '링크 단계' })
    await expect(hops).toHaveCount(1)
    expect(await hops.inputValue()).toBe('0')
  })

  test('F-2007 A3 필터가 없으면 꼬리 줄에 숫자가 없다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: 'B.md', content: 'B 문서' })
    await importMarkdown(page, { name: 'A.md', content: '[[B]]' })

    const map = await openMap(page)
    await expect(footFilter(map)).toHaveCount(0)
    await expect(map.locator('.map-page-foot')).toContainText('노드 3개 · 간선 1개')
  })

  test('F-2007 A4 고립 문서 끄기', async ({ page }) => {
    const view = await openMapCentered(page, [
      { name: 'B.md', content: 'B 문서' },
      { name: 'C.md', content: 'C 문서' },
      { name: 'A.md', content: 'A\n\n[[B]]' },
    ])
    const p = await openPanel(view.map)
    await p.getByRole('checkbox', { name: '고립 문서' }).uncheck()

    await expect(footFilter(view.map)).toHaveText('3개 중 2개 보임')
    await view.map.getByRole('button', { name: '목록', exact: true }).click()
    await expect(
      view.map.locator('.map-list-group', { hasText: '연결이 많은 순' }).getByRole('button', { name: 'C', exact: true }),
    ).toHaveCount(0)
  })

  test('F-2007 A5 끊긴 링크 끄기', async ({ page }) => {
    const view = await openMapCentered(page, [{ name: 'A.md', content: 'A\n\n[[없는 제목]]' }])
    const p = await openPanel(view.map)
    await p.getByRole('checkbox', { name: '끊긴 링크' }).uncheck()

    await expect(footFilter(view.map)).toHaveText('2개 중 1개 보임')
    await view.map.getByRole('button', { name: '목록', exact: true }).click()
    await expect(view.map.locator('.map-list-group h2', { hasText: '끊긴 링크 (0)' })).toBeVisible()
  })

  test('F-2007 A6 링크 단계', async ({ page }) => {
    const view = await openMapCentered(page, [
      { name: 'D.md', content: 'D 문서' },
      { name: 'C.md', content: '[[D]]' },
      { name: 'B.md', content: '[[C]]' },
      { name: 'A.md', content: 'A\n\n[[B]]' },
    ])
    const p = await openPanel(view.map)
    const hops = p.getByRole('slider', { name: '링크 단계' })
    // 중심이 있으면 잠김 안내가 없다 (F-2007 7.5 개정)
    await expect(hops).toHaveAccessibleDescription('')

    await hops.fill('1')
    await expect(footFilter(view.map)).toHaveText('4개 중 2개 보임')
    await hops.fill('2')
    await expect(footFilter(view.map)).toHaveText('4개 중 3개 보임')
  })

  test('F-2007 A7 중심이 없으면 잠긴다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openPanel(map)
    const hops = p.getByRole('slider', { name: '링크 단계' })

    await expect(hops).toBeDisabled()
    await expect(hops).toHaveAttribute('aria-valuetext', '현재 문서가 없습니다')
    await expect(hops).toHaveAccessibleDescription('문서를 연 상태에서 지도를 열거나, 노드 메뉴의 ‘이어진 문서만 보기’를 쓰세요.')
  })

  test('F-2007 A8 파일 검색', async ({ page }) => {
    const view = await openMapCentered(page, [
      { name: '바나나.md', content: '바나나 문서' },
      { name: '사과.md', content: '사과 문서' },
    ])
    const p = await openPanel(view.map)
    await p.getByRole('searchbox', { name: '파일 검색' }).fill('사과')

    await expect(footFilter(view.map)).toHaveText('2개 중 1개 보임')
    await view.map.getByRole('button', { name: '목록', exact: true }).click()
    await expect(view.map.getByRole('button', { name: '바나나', exact: true })).toHaveCount(0)
  })

  test('F-2007 A9 한글 입력기 — 조립 중에는 안 거른다', async ({ page }) => {
    const view = await openMapCentered(page, [
      { name: '바나나.md', content: '바나나 문서' },
      { name: '사과.md', content: '사과 문서' },
    ])
    const p = await openPanel(view.map)
    const search = p.getByRole('searchbox', { name: '파일 검색' })
    await search.fill('사과')
    await expect(footFilter(view.map)).toHaveText('2개 중 1개 보임')

    await search.focus()
    const cdp = await fakeImeCompose(page, '바')
    await page.waitForTimeout(200)
    // 조립 중에는 다시 거르지 않는다 — 먼저 확정된 값(2개 중 1개 보임)이 유지된다
    await expect(footFilter(view.map)).toHaveText('2개 중 1개 보임')

    await fakeImeCommit(cdp, '사과바')
    await expect(footFilter(view.map)).toHaveText('2개 중 0개 보임')
  })

  test('F-2007 A10 파일 검색 은 안 남고 나머지는 남는다', async ({ page }) => {
    const view = await openMapCentered(page, [
      { name: 'B.md', content: 'B 문서' },
      { name: 'A.md', content: 'A\n\n[[B]]' },
    ])
    const p = await openPanel(view.map)
    await p.getByRole('checkbox', { name: '고립 문서' }).uncheck()
    await p.getByRole('slider', { name: '링크 단계' }).fill('2')
    await p.getByRole('searchbox', { name: '파일 검색' }).fill('아무거나')

    await view.map.getByRole('button', { name: '닫기', exact: true }).click()
    await page.goto(`/#/map/${view.id}`)
    const map2 = page.locator('.map-page')
    await expect(map2).toBeVisible()
    const p2 = await openPanel(map2)

    await expect(p2.getByRole('searchbox', { name: '파일 검색' })).toHaveValue('')
    await expect(p2.getByRole('checkbox', { name: '고립 문서' })).not.toBeChecked()
    await expect(p2.getByRole('slider', { name: '링크 단계' })).toHaveValue('2')
  })

  test('F-2007 A11 기본값으로가 필터도 되돌린다', async ({ page }) => {
    const view = await openMapCentered(page, [
      { name: 'B.md', content: 'B 문서' },
      { name: 'A.md', content: 'A\n\n[[B]]' },
    ])
    const p = await openPanel(view.map)
    await p.getByRole('checkbox', { name: '고립 문서' }).uncheck()
    await p.getByRole('checkbox', { name: '끊긴 링크' }).uncheck()
    await p.getByRole('slider', { name: '링크 단계' }).fill('1')
    await p.getByRole('searchbox', { name: '파일 검색' }).fill('무언가')

    await p.getByRole('button', { name: '기본값으로', exact: true }).click()

    await expect(p.getByRole('searchbox', { name: '파일 검색' })).toHaveValue('')
    await expect(p.getByRole('checkbox', { name: '고립 문서' })).toBeChecked()
    await expect(p.getByRole('checkbox', { name: '끊긴 링크' })).toBeChecked()
    await expect(p.getByRole('slider', { name: '링크 단계' })).toHaveValue('0')
    await expect(footFilter(view.map)).toHaveCount(0)
  })

  test('F-2007 A12 걸러진 노드는 안 열린다', async ({ page }) => {
    const view = await openMapCentered(page, [
      { name: 'B.md', content: 'B 문서' },
      { name: 'A.md', content: 'A\n\n[[B]]' },
    ])
    await hoverUntil(page, view.map, view, (n) => n >= 1)
    const spot = await findNodeAboveLabel(page, view.map, 'B')

    const p = await openPanel(view.map)
    await p.getByRole('searchbox', { name: '파일 검색' }).fill('A')
    await expect(footFilter(view.map)).toHaveText('2개 중 1개 보임')
    await view.map.getByRole('button', { name: '지도 설정', exact: true }).click()
    await expect(panel(view.map)).toHaveCount(0)

    await page.mouse.click(spot.x, spot.y)
    await expect(page).toHaveURL(/#\/map\/[^/]+$/)
    // 언마운트가 아니라 숨김이다 (F-2002 A1, F-138 3.2)
    await expect(page.locator('.cm-host .cm-editor')).toBeHidden()

    await page.mouse.move(spot.x, spot.y)
    await expect(visibleLabels(view.map)).toHaveCount(0)
  })

  test('F-2007 A13 목록 에서도 패널이 열린다', async ({ page }) => {
    const view = await openMapCentered(page, [{ name: 'A.md', content: 'A 문서' }])
    await view.map.getByRole('button', { name: '목록', exact: true }).click()
    await expect(view.map.getByRole('button', { name: '지도 설정', exact: true })).toBeVisible()

    const p = await openPanel(view.map)
    await expect(p.locator('.map-panel-section')).toHaveCount(2)
    await expect(p.locator('.map-panel-section-head')).toHaveText(['필터', '그룹'])

    await p.getByRole('checkbox', { name: '고립 문서' }).uncheck()
    await expect(
      view.map.locator('.map-list-group', { hasText: '연결이 많은 순' }).getByRole('button', { name: 'A', exact: true }),
    ).toHaveCount(0)
  })

  test('F-2007 A14 이어진 문서만 보기', async ({ page }) => {
    const view = await openMapCentered(page, [
      { name: 'C.md', content: 'C 문서' },
      { name: 'B.md', content: '[[C]]' },
      { name: 'A.md', content: 'A\n\n[[B]]' },
    ])
    await hoverUntil(page, view.map, view, (n) => n >= 1)
    const spot = await findNodeAboveLabel(page, view.map, 'B')
    await page.mouse.click(spot.x, spot.y, { button: 'right' })
    await nodeMenu(view.map).getByRole('menuitem', { name: '이어진 문서만 보기', exact: true }).click()

    await expect(page).not.toHaveURL(new RegExp(`#/map/${view.id}$`))
    await expect(page).toHaveURL(/#\/map\/[^/]+$/)

    const p = await openPanel(view.map)
    await expect(p.getByRole('slider', { name: '링크 단계' })).toHaveValue('1')
    await expect(footFilter(view.map)).toHaveText('3개 중 3개 보임')
  })
})

// F-2008 지도 설정 패널 `그룹` 색 (specs/features/F-2008.md 13.2) A1~A13 — 캔버스 안의 색은 판정하지 않는다. 통로는 `목록` 보기의 행 앞 색 점이다 (13장)
test.describe('F-2008 지도 설정 패널 그룹', () => {
  test.use({ reducedMotion: 'reduce' })

  test('F-2008 A1 묶음 넷', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openPanel(map)

    await expect(p.locator('.map-panel-section')).toHaveCount(4)
    await expect(p.locator('.map-panel-section-head')).toHaveText(['필터', '그룹', '표시', '장력'])
    await expect(p.getByRole('button', { name: '필터', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await expect(p.getByRole('button', { name: '그룹', exact: true })).toHaveAttribute('aria-expanded', 'false')
  })

  test('F-2008 A2 빈 그룹', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openGroup(map)

    await expect(p.getByRole('button', { name: '새 그룹', exact: true })).toHaveCount(1)
    await expect(p.locator('.map-group-row')).toHaveCount(0)
    await expect(p.getByText('조건에 맞는 문서에 색을 칠합니다.')).toBeVisible()
  })

  test('F-2008 A3 새 그룹', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openGroup(map)
    await p.getByRole('button', { name: '새 그룹', exact: true }).click()

    await expect(p.locator('.map-group-row')).toHaveCount(1)
    await expect(p.getByRole('textbox', { name: '그룹 1 조건' })).toHaveValue('')
    await expect(p.getByRole('radio')).toHaveCount(8)
    await expect(p.getByRole('radio', { name: '색 1' })).toBeChecked()
  })

  test('F-2008 A4 색이 칠해진다', async ({ page }) => {
    const view = await openMapWithDocs(page, [
      { name: '사과.md', content: '사과 문서' },
      { name: '바나나.md', content: '바나나 문서' },
    ])
    const p = await openGroup(view.map)
    await p.getByRole('button', { name: '새 그룹', exact: true }).click()
    await p.getByRole('textbox', { name: '그룹 1 조건' }).fill('사과')

    await view.map.getByRole('button', { name: '목록', exact: true }).click()
    await expect(view.map.getByRole('button', { name: '사과' }).locator('.map-list-dot[data-group="1"]')).toHaveCount(1)
    await expect(view.map.getByRole('button', { name: '바나나' }).locator('.map-list-dot')).toHaveCount(0)
  })

  test('F-2008 A5 색 고르기', async ({ page }) => {
    const view = await openMapWithDocs(page, [{ name: '사과.md', content: '사과 문서' }])
    const p = await openGroup(view.map)
    await p.getByRole('button', { name: '새 그룹', exact: true }).click()
    await p.getByRole('textbox', { name: '그룹 1 조건' }).fill('사과')

    await view.map.getByRole('button', { name: '목록', exact: true }).click()
    await expect(view.map.getByRole('button', { name: '사과' }).locator('.map-list-dot[data-group="1"]')).toHaveCount(1)

    await p.getByRole('radio', { name: '색 3' }).check()

    await expect(view.map.getByRole('button', { name: '사과' }).locator('.map-list-dot[data-group="3"]')).toHaveCount(1)
    await expect(p.getByRole('radio', { name: '색 3' })).toBeChecked()
  })

  test('F-2008 A6 우선순위', async ({ page }) => {
    const view = await openMapWithDocs(page, [
      { name: '사과.md', content: '사과 문서' },
      { name: '바나나.md', content: '바나나 문서' },
    ])
    const p = await openGroup(view.map)
    await p.getByRole('button', { name: '새 그룹', exact: true }).click()
    await p.getByRole('textbox', { name: '그룹 1 조건' }).fill('문서')
    await p.getByRole('button', { name: '새 그룹', exact: true }).click()
    await p.getByRole('textbox', { name: '그룹 2 조건' }).fill('바나나')

    await view.map.getByRole('button', { name: '목록', exact: true }).click()
    await expect(view.map.getByRole('button', { name: '바나나' }).locator('.map-list-dot[data-group="1"]')).toHaveCount(1)
  })

  test('F-2008 A7 삭제', async ({ page }) => {
    const view = await openMapWithDocs(page, [
      { name: '사과.md', content: '사과 문서' },
      { name: '바나나.md', content: '바나나 문서' },
    ])
    const p = await openGroup(view.map)
    await p.getByRole('button', { name: '새 그룹', exact: true }).click()
    await p.getByRole('textbox', { name: '그룹 1 조건' }).fill('사과')
    await p.getByRole('button', { name: '새 그룹', exact: true }).click()
    await p.getByRole('textbox', { name: '그룹 2 조건' }).fill('바나나')

    await view.map.getByRole('button', { name: '목록', exact: true }).click()
    await expect(view.map.getByRole('button', { name: '사과' }).locator('.map-list-dot')).toHaveCount(1)
    await expect(view.map.getByRole('button', { name: '바나나' }).locator('.map-list-dot')).toHaveCount(1)

    await p.getByRole('button', { name: '그룹 1 삭제', exact: true }).click()

    await expect(p.locator('.map-group-row')).toHaveCount(1)
    await expect(p.getByRole('textbox', { name: '그룹 1 조건' })).toHaveValue('바나나')
    await expect(view.map.getByRole('button', { name: '사과' }).locator('.map-list-dot')).toHaveCount(0)
    await expect(view.map.getByRole('button', { name: '바나나' }).locator('.map-list-dot')).toHaveCount(1)
  })

  test('F-2008 A8 남는다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openGroup(map)
    await p.getByRole('button', { name: '새 그룹', exact: true }).click()
    await p.getByRole('textbox', { name: '그룹 1 조건' }).fill('tag:일기')
    await p.getByRole('radio', { name: '색 3' }).check()

    await map.getByRole('button', { name: '닫기', exact: true }).click()
    await page.goto('/#/map')
    const map2 = page.locator('.map-page')
    await expect(map2).toBeVisible()
    const p2 = await openGroup(map2)

    await expect(p2.locator('.map-group-row')).toHaveCount(1)
    await expect(p2.getByRole('textbox', { name: '그룹 1 조건' })).toHaveValue('tag:일기')
    await expect(p2.getByRole('radio', { name: '색 3' })).toBeChecked()
  })

  test('F-2008 A9 기본값으로 는 그룹을 안 지운다', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openGroup(map)
    await p.getByRole('button', { name: '새 그룹', exact: true }).click()
    await p.getByRole('textbox', { name: '그룹 1 조건' }).fill('tag:일기')

    await p.getByRole('button', { name: '표시', exact: true }).click()
    await p.getByRole('slider', { name: '노드 크기', exact: true }).fill('2')

    await p.getByRole('button', { name: '기본값으로', exact: true }).click()

    await expect(p.getByRole('slider', { name: '노드 크기', exact: true })).toHaveValue('1')
    await expect(p.locator('.map-group-row')).toHaveCount(1)
  })

  test('F-2008 A10 상한 8', async ({ page }) => {
    const { map } = await openMapFresh(page)
    const p = await openGroup(map)
    const addBtn = p.getByRole('button', { name: '새 그룹', exact: true })
    for (let i = 0; i < 9; i++) await addBtn.click({ force: true })

    await expect(p.locator('.map-group-row')).toHaveCount(8)
    await expect(addBtn).toBeDisabled()
    await expect(p.getByText('그룹은 8개까지 만들 수 있습니다.')).toBeVisible()
  })

  // F-2008 A11 깨진 그룹 저장값(배열 아닌 객체)은 src/app/mapPrefs.test.ts U10 이 본다 (2026-09-25 e2e 경량화)

  test('F-2008 A12 한글 입력기', async ({ page }) => {
    const view = await openMapWithDocs(page, [
      { name: '사과.md', content: '사과 문서' },
      { name: '바나나.md', content: '바나나 문서' },
    ])
    const p = await openGroup(view.map)
    await p.getByRole('button', { name: '새 그룹', exact: true }).click()
    const input = p.getByRole('textbox', { name: '그룹 1 조건' })
    await input.fill('사과')

    await view.map.getByRole('button', { name: '목록', exact: true }).click()
    await expect(view.map.getByRole('button', { name: '사과' }).locator('.map-list-dot')).toHaveCount(1)

    await input.fill('')
    await expect(view.map.locator('.map-list-dot')).toHaveCount(0)

    await input.focus()
    const cdp = await fakeImeCompose(page, '바')
    await page.waitForTimeout(400)
    // 조립 중에는 다시 칠하지 않는다 — 앞서 확정된 상태(점 0개)가 유지된다
    await expect(view.map.locator('.map-list-dot')).toHaveCount(0)

    await fakeImeCommit(cdp, '바나나')
    await expect(view.map.getByRole('button', { name: '바나나' }).locator('.map-list-dot')).toHaveCount(1)
  })

  test('F-2008 A13 목록 에서도 그룹 을 고친다', async ({ page }) => {
    const view = await openMapWithDocs(page, [{ name: 'A.md', content: 'A 문서' }])
    await view.map.getByRole('button', { name: '목록', exact: true }).click()
    const p = await openPanel(view.map)

    await expect(p.locator('.map-panel-section')).toHaveCount(2)
    await expect(p.locator('.map-panel-section-head')).toHaveText(['필터', '그룹'])

    await p.getByRole('button', { name: '그룹', exact: true }).click()
    await p.getByRole('button', { name: '새 그룹', exact: true }).click()
    await p.getByRole('textbox', { name: '그룹 1 조건' }).fill('A')

    await expect(view.map.getByRole('button', { name: 'A' }).locator('.map-list-dot')).toHaveCount(1)
  })
})

// F-2013 호버 초점 전환(여러 프레임에 걸친 그림 변화) A1~A5 는 시각 값이라 e2e 에서 뺐다 — specs/human-checks.md (2026-09-25 e2e 경량화)

// 지도 조작을 이어서 해도 깨지지 않는지 — F-2003 A13·F-2004 A9·F-2005 A12·F-2006 A7·F-2009 A8·F-2010 A6 여섯 스모크를 하나로 합쳤다 (2026-09-25 e2e 경량화)
test.describe('지도 이어서 조작 스모크', () => {
  test.use({ reducedMotion: 'reduce' })

  test('이동·회전·휠·호버·노드 끌기·표시·장력 슬라이더를 이어서 해도 오류 없고, 맞춤 뒤 노드를 누르면 열린다', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    const { map, H, cx, cy } = await openMapFresh(page)

    // F-2003 A13·F-2004 A9 — 이동·회전·휠·호버
    await drag(page, cx - 0.45 * H, cy + 0.42 * H, 0.55 * H, 0, 'left')
    await drag(page, cx - 0.3 * H, cy, 0.5 * H, 0, 'right')
    await page.mouse.move(cx, cy)
    await page.mouse.wheel(0, 1200)
    await page.waitForTimeout(SETTLE)
    await page.mouse.move(cx, cy)

    // F-2009 A8 — 노드 끌기
    await map.getByRole('button', { name: '맞춤', exact: true }).click()
    await page.waitForTimeout(SETTLE)
    await drag(page, cx, cy, 0.3 * H, 0, 'left')
    await page.waitForTimeout(SETTLE)

    // F-2005 A12 — 표시 슬라이더
    const display = await openDisplay(map)
    const nodeScale = display.getByRole('slider', { name: '노드 크기', exact: true })
    await nodeScale.fill('0.5')
    await nodeScale.fill('3')
    await nodeScale.fill('1.4')
    const edgeStrength = display.getByRole('slider', { name: '선 두께', exact: true })
    await edgeStrength.fill('0')
    await edgeStrength.fill('1')

    // F-2006 A7 — 장력 슬라이더 끝에서 끝까지. 패널은 이미 열려 있으니 묶음만 펼친다(openForce 는 패널 버튼을 다시 눌러 닫아 버린다)
    await display.getByRole('button', { name: '장력', exact: true }).click()
    const force = display
    for (const name of FORCE_NAMES) {
      const slider = forceSlider(force, name)
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
    await map.getByRole('button', { name: '맞춤', exact: true }).click()
    await page.waitForTimeout(SETTLE)
    await page.mouse.click(cx, cy)
    await expect(page).toHaveURL(/#\/d\/[^/]+$/)
    expect(errors).toEqual([])
  })
})
