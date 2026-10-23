// 공유 폴더 안에 편집 초대자가 새 문서 만들기 (specs/features/F-2166.md 5장 E1~E3)
import { test, expect } from '@playwright/test'
import { setPrefBeforeLoad } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'
import { createFakeDocRoom } from './fixtures/fakeDocRoom.js'

const NOW = Date.now()
const OWNER = 'owner@x.com'

function sharedDoc(id, title, content, extra = {}) {
  return { id, title, content, lineEnding: 'lf', folderId: 'G', pinnedAt: null, version: 1, createdAt: NOW, updatedAt: NOW, role: 'edit', ownerEmail: OWNER, viaFolder: { id: 'F', name: '수업' }, ...extra }
}

async function boot(page, { folders, docs, hash, createStatus = 201, createBody }) {
  const world = { docs, posts: [], docPosts: [] }
  await fakeServer(page)
  const room = createFakeDocRoom()
  for (const d of docs) {
    room.seed(d.id, { content: d.content, title: d.title })
    if (d.role === 'view') room.setRole(d.id, 'u1', 'view')
  }
  await room.install(page.context())
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname
    if (req.method() === 'POST' && path === '/api/docs') world.docPosts.push(req.postDataJSON())
  })
  await page.route(/\/api\/docs\/(SD|VD)$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const id = new URL(route.request().url()).pathname.split('/').pop()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(world.docs.find((d) => d.id === id)) })
  })
  await page.route('**/api/shared*', (route) => {
    const list = world.docs.map((d) => ({ ...d, content: undefined }))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ docs: list, folders }) })
  })
  await page.route(/\/api\/shared\/folders\/[^/]+\/docs$/, (route) => {
    const folderId = new URL(route.request().url()).pathname.split('/').at(-2)
    const body = route.request().postDataJSON()
    world.posts.push({ folderId, body })
    if (createStatus !== 201) return route.fulfill({ status: createStatus, contentType: 'application/json', body: JSON.stringify(createBody ?? {}) })
    const doc = sharedDoc(body.id, body.title, body.content, { folderId, viaFolder: folderId === 'E' ? { id: 'E', name: '빈수업' } : { id: 'F', name: '수업' } })
    world.docs.push(doc)
    room.seed(doc.id, { content: doc.content, title: doc.title })
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...doc, content: undefined }) })
  })
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await page.goto(hash)
  await expect(page.locator('.shared-doc-list')).toBeVisible()
  return world
}

async function clickLink(page, text) {
  await page.locator('.cm-content').getByText('본문', { exact: true }).click()
  await page.locator('.cm-content .md-wikilink').filter({ hasText: text }).click()
}

const FOLDER_EDIT = { id: 'F', name: '수업', role: 'edit', ownerEmail: OWNER }

test.describe('F-2166 공유 폴더 새 문서', () => {
  test('F-2166 E1 하위 폴더 문서의 없는 위키링크는 그 폴더로 만들어진다', async ({ page }) => {
    const world = await boot(page, { folders: [FOLDER_EDIT], docs: [sharedDoc('SD', '원본', '[[2주차 과제]]\n\n본문\n')], hash: '/#/d/SD' })
    await clickLink(page, '2주차 과제')
    await expect(page.locator('.doc-title')).toHaveValue('2주차 과제')
    await expect(page.locator('.doc-title')).toBeFocused()
    expect(world.posts).toHaveLength(1)
    expect(world.posts[0]).toMatchObject({ folderId: 'G', body: { title: '2주차 과제' } })
    expect(world.docPosts).toHaveLength(0)
    await expect(page.locator('[data-shared-folder-id="F"]').getByText('2주차 과제')).toBeVisible()
  })

  test('F-2166 E2 문서 없는 편집 초대 폴더 줄 메뉴의 새 문서', async ({ page }) => {
    const empty = { id: 'E', name: '빈수업', role: 'edit', ownerEmail: OWNER }
    const world = await boot(page, { folders: [FOLDER_EDIT, empty], docs: [sharedDoc('SD', '원본', '본문\n')], hash: '/#/d/SD' })
    const row = page.locator('[data-shared-folder-id="E"] .shared-folder-row')
    await row.hover()
    await row.getByRole('button', { name: '빈수업 메뉴' }).click()
    await page.getByRole('menuitem', { name: '새 문서' }).click()
    await expect(page.locator('.doc-title')).toHaveValue('제목 없는 문서')
    await expect(page.locator('.doc-title')).toBeFocused()
    expect(world.posts[0]).toMatchObject({ folderId: 'E', body: { title: '제목 없는 문서' } })
    await expect(page.locator('[data-shared-folder-id="E"]').getByText('제목 없는 문서')).toBeVisible()
  })

  test('F-2166 E3 주인 용량 초과면 알림만, 보기 초대 폴더면 내 최상위에 만든다', async ({ page, browser }) => {
    const world = await boot(page, {
      folders: [FOLDER_EDIT],
      docs: [sharedDoc('SD', '원본', '[[A과제]]\n\n본문\n')],
      hash: '/#/d/SD',
      createStatus: 413,
      createBody: { error: 'owner_quota_exceeded', resource: 'bytes' },
    })
    await clickLink(page, 'A과제')
    await expect(page.locator('.notice--error .notice-message')).toHaveText('공유 폴더 주인의 저장 공간이 가득 찼습니다.')
    expect(page.url()).toContain('#/d/SD')
    await expect(page.locator('[data-shared-folder-id="F"] .tree-row')).toHaveCount(2)
    expect(world.docPosts).toHaveLength(0)

    const page2 = await (await browser.newContext()).newPage()
    const world2 = await boot(page2, {
      folders: [{ ...FOLDER_EDIT, role: 'view' }],
      docs: [sharedDoc('VD', '보기원본', '[[B과제]]\n\n본문\n', { role: 'view' })],
      hash: '/#/d/VD',
    })
    await clickLink(page2, 'B과제')
    await expect(page2.locator('.doc-title')).toHaveValue('B과제')
    expect(world2.posts).toHaveLength(0)
    expect(world2.docPosts).toHaveLength(1)
    expect(world2.docPosts[0]).toMatchObject({ title: 'B과제', folderId: null })
    await expect(page2.locator('.notice--info .notice-message')).toHaveText('공유 폴더에 만들 권한이 없어 내 문서에 만들었습니다.')
  })
})
