// 위키링크 지도 3D 판 (specs/features/F-2002.md 12.2) A1~A16 — 캔버스 안의 좌표·색·크기는 판정하지 않고, 노드 클릭 경로는 목록 통로로 판정한다 (F-292 11장)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, waitSaved } from './helpers.js'

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
    // 눌러도 아무 일 없는 단추를 미리 두지 않는다 (15장 Q3)
    await expect(map.getByRole('button', { name: '설정', exact: true })).toHaveCount(0)

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
