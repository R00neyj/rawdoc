// 위키링크 지도 (specs/features/F-292.md) — A7~A16. 시각값(좌표·색·크기)은 사람 확인으로 넘긴다(10장)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, waitSaved } from './helpers.js'

// 사이드바 `지도` 버튼을 눌러 지도 화면을 연다
async function openMap(page) {
  await page.getByRole('button', { name: '지도' }).first().click()
  await expect(page.locator('.map-page')).toBeVisible()
  return page.locator('.map-page')
}

test.describe('F-292 A7 열기', () => {
  test('사이드바 지도 클릭 — 전체 화면, 해시 #/map/{현재 문서 id}, 편집기 숨김', async ({ page }) => {
    await openApp(page)
    const docId = await currentDocId(page)
    await openMap(page)
    await expect(page).toHaveURL(new RegExp(`#/map/${docId}$`))
    await expect(page.locator('.cm-host .cm-editor')).toBeHidden()
    await expect(page.locator('.dialog[open]')).toHaveCount(0)
  })
})

test.describe('F-292 A8 노드 클릭', () => {
  test('[[B]] 가 있는 문서 A 에서 지도 → B 노드 클릭 — B 가 열리고 지도는 닫힌다', async ({ page }) => {
    await openApp(page)
    const bId = await importMarkdown(page, { name: 'B.md', content: 'B 문서' })
    await importMarkdown(page, { name: 'A.md', content: '[[B]]' })

    const map = await openMap(page)
    await map.locator('[data-node-title="B"]').click()

    await expect(page).toHaveURL(new RegExp(`#/d/${bId}$`))
    await expect(page.locator('.map-page')).toHaveCount(0)
  })
})

test.describe('F-292 A9 전체·현재 전환', () => {
  test('전체 ↔ 현재 문서 — 해시가 바뀌고 단계 세그먼트가 전체에서는 안 보인다', async ({ page }) => {
    await openApp(page)
    const docId = await currentDocId(page)
    const map = await openMap(page)

    await expect(page).toHaveURL(new RegExp(`#/map/${docId}$`))
    await expect(map.getByRole('button', { name: '1단계' })).toBeVisible()

    await map.getByRole('button', { name: '전체', exact: true }).click()
    await expect(page).toHaveURL(/#\/map$/)
    await expect(map.getByRole('button', { name: '1단계' })).toHaveCount(0)

    await map.getByRole('button', { name: '현재 문서' }).click()
    await expect(page).toHaveURL(new RegExp(`#/map/${docId}$`))
    await expect(map.getByRole('button', { name: '1단계' })).toBeVisible()
  })
})

test.describe('F-292 A10 단계', () => {
  test('1단계 → 2단계 — 노드 수가 늘어난다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: 'C.md', content: 'C 문서' })
    await importMarkdown(page, { name: 'B.md', content: '[[C]]' })
    await importMarkdown(page, { name: 'A.md', content: '[[B]]' }) // A 가 현재 문서 — A-B-C 사슬, C 는 깊이 2

    const map = await openMap(page)
    const nodeCount = () => map.locator('.map-graph [data-node]').count()

    await expect.poll(nodeCount).toBe(2) // 1단계: A, B
    await map.getByRole('button', { name: '2단계' }).click()
    await expect.poll(nodeCount).toBe(3) // 2단계: A, B, C
  })
})

test.describe('F-292 A11 끊긴 링크', () => {
  test('끊긴 링크 노드 클릭 — 새 문서가 생겨 열리고, 다시 지도를 열면 끊긴 링크가 아니다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: 'A.md', content: '[[없는 제목]]' })

    const map = await openMap(page)
    await map.locator('[data-node-title="없는 제목"]').click()

    await expect(page.locator('.doc-title')).toHaveValue('없는 제목')
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(page.locator('.map-page')).toHaveCount(0)

    const map2 = await openMap(page)
    const node = map2.locator('[data-node-title="없는 제목"]')
    await expect(node.locator('circle.map-node--missing')).toHaveCount(0)
    await expect(node.locator('circle.map-node')).toHaveCount(1)
  })
})

test.describe('F-292 A12 빈 상태', () => {
  test('링크 없는 문서 하나뿐인 상태 — 문서별 안내와 전체 보기 버튼', async ({ page }) => {
    await openApp(page) // 첫 실행 — 사용법 문서 하나뿐이고 위키링크가 없다
    const map = await openMap(page)
    await expect(map.getByText('이 문서에 이어진 문서가 없습니다.')).toBeVisible()
    await expect(map.getByRole('button', { name: '전체 보기' })).toBeVisible()
  })
})

test.describe('F-292 A13 목록', () => {
  test('목록 세그먼트 — 나가는·끊긴 묶음이 보이고 나가는 링크 항목 클릭은 A8 과 같다', async ({ page }) => {
    await openApp(page)
    const bId = await importMarkdown(page, { name: 'B.md', content: 'B 문서' })
    await importMarkdown(page, { name: 'A.md', content: '[[B]] [[없는 제목]]' })

    const map = await openMap(page)
    await map.getByRole('button', { name: '목록', exact: true }).click()

    await expect(map.locator('.map-list-group h2', { hasText: '나가는 링크 (1)' })).toBeVisible()
    await expect(map.locator('.map-list-group h2', { hasText: '끊긴 링크 (1)' })).toBeVisible()

    await map.getByRole('button', { name: 'B', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`#/d/${bId}$`))
    await expect(page.locator('.map-page')).toHaveCount(0)
  })

  test('끊긴 링크 항목 클릭은 A11 과 같다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: 'A.md', content: '[[없는 제목]]' })

    const map = await openMap(page)
    await map.getByRole('button', { name: '목록', exact: true }).click()
    await map.getByRole('button', { name: '없는 제목', exact: true }).click()

    await expect(page.locator('.doc-title')).toHaveValue('없는 제목')
    await expect(page.locator('.map-page')).toHaveCount(0)
  })
})

test.describe('F-292 A14 닫기·뒤로 가기', () => {
  test('닫기 — 열기 전 문서로 돌아온다', async ({ page }) => {
    await openApp(page)
    const docId = await currentDocId(page)
    const map = await openMap(page)

    await map.getByRole('button', { name: '닫기' }).click()
    await expect(page).toHaveURL(new RegExp(`#/d/${docId}$`))
    await expect(page.locator('.map-page')).toHaveCount(0)
  })

  test('브라우저 뒤로 가기 — 열기 전 문서로 돌아온다', async ({ page }) => {
    await openApp(page)
    const docId = await currentDocId(page)
    await openMap(page)

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`#/d/${docId}$`))
    await expect(page.locator('.map-page')).toHaveCount(0)
  })
})

test.describe('F-292 A15 직접 진입', () => {
  test('#/map 주소로 새로 열면 전체 보기 지도가 뜬다', async ({ page }) => {
    await page.goto('/#/map')
    await expect(page.locator('.map-page')).toBeVisible()
    await expect(page.getByRole('button', { name: '전체', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('F-292 A16 편집 보존 회귀', () => {
  test('문서를 고치고 지도 → 닫기 → 같은 문서 — 방금 친 글자가 남고 실행 취소가 된다', async ({ page }) => {
    await openApp(page)
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('방금친글자')
    await waitSaved(page)

    const map = await openMap(page)
    await map.getByRole('button', { name: '닫기' }).click()

    await expect(page.locator('.cm-content')).toContainText('방금친글자')
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+z')
    await expect(page.locator('.cm-content')).not.toContainText('방금친글자')
  })
})
