// 공개 보기의 권한 요청 버튼과 대화상자 D-23 (specs/features/F-2135.md)
import { test, expect } from '@playwright/test'

const NONE = { target: 'doc', owner: false, memberRole: null, targetId: null, request: null }
const PENDING = { ...NONE, request: { state: 'pending', role: 'edit', retryAt: null } }

function json(body, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

async function mockPublicDoc(page, token, docs = {}) {
  await page.route(`**/pub/docs/${token}/set`, (route) =>
    route.fulfill(json({ docs: [{ id: 'a1', title: '문서A' }, { id: 'b1', title: '문서B' }] })),
  )
  await page.route(`**/pub/docs/${token}/docs/*`, (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()
    return route.fulfill(json(docs[id] ?? { title: id, content: 'x\n', lineEnding: 'lf', updatedAt: 1 }))
  })
  await page.route(`**/pub/docs/${token}`, (route) =>
    route.fulfill(json({ title: '문서A', content: '[[문서B]]\n', lineEnding: 'lf', updatedAt: 1 })),
  )
}

test('F-2135 E1 권한 요청 보내기·새로고침 뒤 대기 유지·요청 취소', async ({ page }) => {
  await mockPublicDoc(page, 'tok123')
  let state = NONE
  const posts = []
  let deletes = 0
  await page.route('**/api/access-requests/**', (route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      posts.push(req.postData())
      state = PENDING
      return route.fulfill(json(PENDING, 201))
    }
    if (req.method() === 'DELETE') {
      deletes++
      state = NONE
      return route.fulfill({ status: 204 })
    }
    return route.fulfill(json(state))
  })

  await page.goto('/#/p/tok123')
  await page.getByRole('button', { name: '권한 요청', exact: true }).click()
  await page.getByRole('radio', { name: /편집/ }).check()
  await page.getByRole('button', { name: '요청 보내기' }).click()
  await expect(page.getByRole('button', { name: '권한 요청 보냄' })).toBeVisible()
  expect(posts).toEqual(['{"role":"edit"}'])

  await page.reload()
  await page.getByRole('button', { name: '권한 요청 보냄' }).click()
  await page.getByRole('button', { name: '요청 취소' }).click()
  await expect(page.getByRole('button', { name: '권한 요청', exact: true })).toBeVisible()
  expect(deletes).toBe(1)
})

test('F-2135 E2 보기 권한이면 앱에서 열기가 해당 문서로 간다', async ({ page }) => {
  await mockPublicDoc(page, 'tok123')
  await page.route('**/api/access-requests/**', (route) =>
    route.fulfill(json({ ...NONE, memberRole: 'view', targetId: 'd1' })),
  )
  await page.goto('/#/p/tok123')
  await page.getByRole('button', { name: '앱에서 열기' }).click()
  await expect(page).toHaveURL(/\/\?app=1#\/d\/d1$/)
})

test('F-2135 E3 묶음 둘째 문서는 docId 를 달고, 폴더 링크는 달지 않는다', async ({ page }) => {
  await mockPublicDoc(page, 'tokSet')
  const urls = []
  await page.route('**/api/access-requests/**', (route) => {
    urls.push(route.request().url())
    return route.fulfill(json(NONE))
  })
  await page.goto('/#/p/tokSet')
  await expect(page.getByRole('button', { name: '권한 요청', exact: true })).toBeVisible()
  expect(urls.at(-1)).not.toContain('docId')
  await page.locator('a.wikilink', { hasText: '문서B' }).click()
  await expect.poll(() => urls.at(-1)).toContain('?docId=b1')

  await page.route('**/pub/folders/tokF', (route) =>
    route.fulfill(json({ name: '폴더', folders: [], docs: [{ id: 'd1', title: '문서1', folderId: 'root', updatedAt: 1 }] })),
  )
  await page.route('**/pub/folders/tokF/docs/*', (route) =>
    route.fulfill(json({ title: '문서1', content: '본문\n', lineEnding: 'lf', updatedAt: 1 })),
  )
  urls.length = 0
  await page.goto('/#/p/f/tokF')
  await expect(page.getByRole('button', { name: '권한 요청', exact: true })).toBeVisible()
  expect(urls.length).toBeGreaterThan(0)
  expect(urls.every((u) => !u.includes('docId'))).toBe(true)
})
