// GitHub 연결·가져오기 화면 (specs/features/F-2128.md 7장)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, setPrefBeforeLoad } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'
import { createFakeDocRoom } from './fixtures/fakeDocRoom.js'

const BOM = Buffer.from([0xef, 0xbb, 0xbf])
const MEMO = Buffer.concat([BOM, Buffer.from('# 제목\n본문\n', 'utf-8')])

test.describe('F-2128 GitHub', () => {
  test('F-2128 E1 사이드바 가져오기 → 연결된 새 문서, 새로고침 뒤 상단바 상태 줄', async ({ page }) => {
    const server = await fakeServer(page, {
      github: { enabled: true, connected: true, repos: ['o/r'], files: { 'o/r@main:docs/메모.markdown': { sha: 'S1', bytes: MEMO } } },
    })
    await openApp(page)
    const before = await currentDocId(page)

    await page.locator('.sidebar').getByRole('button', { name: '가져오기', exact: true }).click()
    await page.getByRole('menuitem', { name: 'GitHub에서 가져오기…' }).click()
    const dialog = page.getByRole('dialog', { name: 'GitHub에서 가져오기' })
    await dialog.getByRole('button', { name: 'docs/', exact: true }).click()
    await dialog.getByRole('button', { name: '메모.markdown', exact: true }).click()
    await dialog.getByRole('button', { name: '가져오기', exact: true }).click()

    await expect.poll(async () => currentDocId(page)).not.toBe(before)
    const docId = await currentDocId(page)
    await expect(page.locator('.doc-title')).toHaveValue('메모')
    await expect.poll(() => server.docs.get(docId)?.content).toBe('# 제목\n본문\n')
    const put = server.githubRequests().find((r) => r.method === 'PUT')
    expect(put.body).toEqual({ repo: 'o/r', branch: 'main', path: 'docs/메모.markdown', sha: 'S1', bom: true })

    await page.reload()
    await page.getByRole('button', { name: 'GitHub', exact: true }).click()
    await expect(page.locator('.github-menu-status')).toContainText('o/r · docs/메모.markdown')
  })

  test('F-2128 E2 연결 안 됨 → 계정 연결로 떠났다 돌아오면 질의를 지우고 대화상자를 다시 연다', async ({ page }) => {
    const server = await fakeServer(page, { github: { enabled: true, connected: false, repos: ['o/r'] } })
    let returned = null
    await page.route('**/api/github/connect*', (route) => {
      const url = new URL(route.request().url())
      returned = url.searchParams.get('return')
      server.setGithub({ connected: true })
      return route.fulfill({ status: 302, headers: { location: `/?app=1&github=connected${returned}` } })
    })
    await openApp(page)
    const hash = await page.evaluate(() => location.hash)

    await page.locator('.sidebar').getByRole('button', { name: '가져오기', exact: true }).click()
    await page.getByRole('menuitem', { name: 'GitHub에서 가져오기…' }).click()
    await page.getByRole('dialog', { name: 'GitHub에서 가져오기' }).getByRole('button', { name: 'GitHub 연결', exact: true }).click()

    const dialog = page.getByRole('dialog', { name: 'GitHub에서 가져오기' })
    await expect(dialog.getByLabel('저장소')).toBeVisible()
    expect(returned).toBe(hash)
    expect(await page.evaluate(() => location.search)).toBe('?app=1')

    await page.goto('/?app=1&github_error=denied#/')
    await expect(page.locator('.notice--error .notice-message').last()).toHaveText('GitHub 연결을 취소했습니다')
    expect(await page.evaluate(() => location.search)).toBe('?app=1')
  })

  test('F-2128 E3 문서 ⋯ → GitHub에 연결 → 상단바 메뉴 → 연결 해제', async ({ page }) => {
    const server = await fakeServer(page, { github: { enabled: true, connected: true, repos: ['o/r'] } })
    await openApp(page)
    await importMarkdown(page, { name: 'doc.md', content: '내용\n' })
    const docId = await currentDocId(page)
    const row = page.locator('.tree-row').filter({ hasText: 'doc' }).first()

    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'GitHub에 연결…' }).click()
    const dialog = page.getByRole('dialog', { name: 'GitHub에 연결' })
    await expect(dialog.getByLabel('파일 이름')).toHaveValue('doc.md')
    await dialog.getByRole('button', { name: '연결', exact: true }).click()

    await expect.poll(() => server.githubLinks.get(docId)?.path).toBe('doc.md')
    const put = server.githubRequests().find((r) => r.method === 'PUT')
    expect(put.body).toEqual({ repo: 'o/r', branch: 'main', path: 'doc.md', sha: null, bom: false })
    const githubButton = page.getByRole('button', { name: 'GitHub', exact: true })
    await expect(githubButton).toBeVisible()

    await githubButton.click()
    await page.getByRole('menuitem', { name: '연결 해제…' }).click()
    await page.getByRole('dialog', { name: 'GitHub 연결 해제' }).getByRole('button', { name: '연결 해제', exact: true }).click()

    await expect(githubButton).toHaveCount(0)
    expect(server.githubRequests().filter((r) => r.method === 'DELETE')).toHaveLength(1)
    await row.click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'GitHub에 연결…' })).toBeVisible()
  })
})

// F-2129 8장 — 실시간 문서 + 미리 둔 연결로 당기기
const PULL_DOC = 'gh-pull-doc'
const LINES = ['첫째 줄', '둘째 줄', '셋째 줄', '넷째 줄', '다섯째 줄', '여섯째 줄', '일곱째 줄', '여덟째 줄', '아홉째 줄']
const BODY = LINES.join('\n')
const REMOTE = LINES.map((l, i) => (i === 1 || i === 7 ? `${l} 원격` : l)).join('\n')

async function openLinkedDoc(page, room, { remote, syncedAt = null, lineEnding = 'lf', link = {}, body = BODY, atts = [] }) {
  const server = await fakeServer(page, { github: { enabled: true, connected: true, repos: ['o/r'], files: { 'o/r@main:doc.md': { sha: 'S2', bytes: remote } } } })
  await room.install(page.context())
  const now = Date.now()
  server.docs.set(PULL_DOC, { id: PULL_DOC, title: '당길 문서', content: body, lineEnding, folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now })
  server.githubLinks.set(PULL_DOC, {
    repo: 'o/r', branch: 'main', path: 'doc.md', remoteSha: 'S1', remoteBom: false, syncedAt, htmlUrl: 'https://github.com/o/r/blob/main/doc.md', images: {}, ...link,
  })
  for (const name of atts) server.attachments.set(name, { mime: 'image/png', bytes: PNG, width: 1, height: 1 })
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await page.goto(`/#/d/${PULL_DOC}`)
  await expect(page.locator('.cm-content').first()).toContainText('아홉째 줄')
  return server
}

async function startPull(page) {
  await page.getByRole('button', { name: 'GitHub', exact: true }).click()
  await page.getByRole('menuitem', { name: '당기기…' }).click()
}

const pullDialog = (page) => page.getByRole('dialog', { name: 'GitHub에서 당기기' })
const requestsTo = (server, suffix) => server.githubRequests().filter((r) => r.path.endsWith(suffix))

test.describe('F-2129 GitHub 당기기', () => {
  test('F-2129 E1 첫 덩어리만 GitHub 것으로 → 적용 → synced, Ctrl+Z 한 번에 처음으로', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(PULL_DOC, { content: BODY, title: '당길 문서' })
    const server = await openLinkedDoc(page, room, { remote: REMOTE })

    await startPull(page)
    const dialog = pullDialog(page)
    await expect(dialog.getByRole('button', { name: 'GitHub 것으로' })).toHaveCount(2)
    await dialog.getByRole('button', { name: 'GitHub 것으로' }).first().click()
    await dialog.getByRole('button', { name: '적용', exact: true }).click()

    const merged = LINES.map((l, i) => (i === 1 ? `${l} 원격` : l)).join('\n')
    await expect.poll(() => room.content(PULL_DOC)).toBe(merged)
    await expect(dialog).toHaveCount(0)
    expect(requestsTo(server, '/synced').map((r) => r.body)).toEqual([{ sha: 'S2', bom: false }])
    await expect(page.locator('.notice-message', { hasText: 'GitHub에서 당겨 합쳤습니다' })).toBeVisible()

    await page.locator('.cm-content').first().locator('.cm-line', { hasText: '다섯째 줄' }).click()
    await page.keyboard.press('Control+z')
    await expect.poll(() => room.content(PULL_DOC)).toBe(BODY)
  })

  test('F-2129 E2 연 뒤 다른 창이 본문을 바꾸면 다시 비교, 두 번째 적용에 둘 다 들어간다', async ({ page, browser, baseURL }) => {
    const room = createFakeDocRoom()
    room.seed(PULL_DOC, { content: BODY, title: '당길 문서' })
    const server = await openLinkedDoc(page, room, { remote: REMOTE })
    const otherCtx = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' })
    try {
      const other = await otherCtx.newPage()
      await openLinkedDoc(other, room, { remote: REMOTE })

      await startPull(page)
      const dialog = pullDialog(page)
      await expect(dialog.getByRole('button', { name: 'GitHub 것으로' })).toHaveCount(2)

      // 명세는 1번 줄이지만 원격이 바꾼 2번 줄과 붙어 덩어리 하나로 묶인다(toChunks) — 바뀐 줄과 떨어진 5번 줄에 쓴다
      await other.locator('.cm-content').first().locator('.cm-line', { hasText: '다섯째 줄' }).click()
      await other.keyboard.press('End')
      await other.keyboard.type('!')
      const withBang = BODY.replace('다섯째 줄', '다섯째 줄!')
      await expect.poll(() => room.content(PULL_DOC)).toBe(withBang)
      await expect(page.locator('.cm-content').first()).toContainText('다섯째 줄!')

      await dialog.getByRole('button', { name: '적용', exact: true }).click()
      await expect(dialog.getByRole('status')).toHaveText('그사이 본문이 바뀌어 다시 비교합니다')
      expect(room.content(PULL_DOC)).toBe(withBang)
      expect(requestsTo(server, '/synced')).toHaveLength(0)

      await dialog.getByRole('button', { name: 'GitHub 것으로' }).first().click()
      await dialog.getByRole('button', { name: '적용', exact: true }).click()
      await expect.poll(() => room.content(PULL_DOC)).toBe(withBang.replace('둘째 줄', '둘째 줄 원격'))
      expect(requestsTo(server, '/pull')).toHaveLength(1)
    } finally {
      await otherCtx.close()
    }
  })

  test('F-2129 E3 줄바꿈만 다르면 합치기 없이 같음 알림, synced 로 상태 줄이 바뀐다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(PULL_DOC, { content: BODY, title: '당길 문서' })
    const server = await openLinkedDoc(page, room, { remote: BODY.replace(/\n/g, '\r\n') })

    await page.getByRole('button', { name: 'GitHub', exact: true }).click()
    await expect(page.locator('.github-menu-status')).toContainText('아직 맞춘 적 없음')
    await page.getByRole('menuitem', { name: '당기기…' }).click()

    await expect(page.locator('.notice-message', { hasText: 'GitHub 파일과 같습니다' })).toHaveText(
      'GitHub 파일과 같습니다. 줄바꿈만 다릅니다 (GitHub CRLF, 이 문서 LF). 푸시하면 이 문서 형식으로 올라갑니다',
    )
    await expect(page.locator('.github-pull-merge')).toHaveCount(0)
    expect(requestsTo(server, '/synced')).toHaveLength(1)
    await page.getByRole('button', { name: 'GitHub', exact: true }).click()
    await expect(page.locator('.github-menu-status')).toContainText('마지막 동기화')
  })
})

// F-2130 8장 — 푸시
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const PUSH_NAME = '0123456789abcdef.png'
const pushDialog = (page) => page.getByRole('dialog', { name: 'GitHub에 푸시' })
async function openPush(page) {
  await page.getByRole('button', { name: 'GitHub', exact: true }).click()
  await page.getByRole('menuitem', { name: '푸시…', exact: true }).click()
}

test.describe('F-2130 GitHub 푸시', () => {
  test('F-2130 E1 BOM·CRLF 본문과 새 그림 한 장을 푸시, 요청 순서와 몸통, 상태 줄', async ({ page }) => {
    const room = createFakeDocRoom()
    const body = `${BODY}\n\n![](attachments/${PUSH_NAME})\n`
    room.seed(PULL_DOC, { content: body, title: '당길 문서' })
    const server = await openLinkedDoc(page, room, { remote: 'x', lineEnding: 'crlf', link: { remoteSha: 'S2', remoteBom: true }, body, atts: [PUSH_NAME] })

    await openPush(page)
    const dialog = pushDialog(page)
    await expect(dialog.getByText('새 그림 1장')).toBeVisible()
    await dialog.getByLabel('커밋 메시지').fill('  첫 푸시\n')
    await dialog.getByRole('button', { name: '푸시', exact: true }).click()

    await expect(page.locator('.notice-message', { hasText: '푸시했습니다' })).toBeVisible()
    const reqs = server.githubRequests().filter((r) => /push-plan|blobs|\/push$/.test(r.path))
    expect(reqs.map((r) => r.path.split('/').pop())).toEqual(['push-plan', 'push-plan', 'blobs', 'blobs', 'push'])
    const mdBlob = Buffer.from(reqs[2].body.content, 'base64')
    expect(mdBlob.equals(Buffer.concat([BOM, Buffer.from(body.replace(/\n/g, '\r\n'), 'utf-8')]))).toBe(true)
    const pushBody = reqs[4].body
    expect(pushBody.message).toBe('첫 푸시')
    expect(pushBody.images).toEqual([{ name: PUSH_NAME, sha: expect.any(String) }])
    expect(pushBody.mdSha).not.toBe(pushBody.images[0].sha)
    await page.getByRole('button', { name: 'GitHub', exact: true }).click()
    await expect(page.locator('.github-menu-status')).toContainText('마지막 동기화')
  })

  test('F-2130 E2 원격이 바뀌어 충돌 → 당기기 → 다시 푸시 대화상자에 메시지가 남아 있다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(PULL_DOC, { content: BODY, title: '당길 문서' })
    const server = await openLinkedDoc(page, room, { remote: BODY })

    await openPush(page)
    const dialog = pushDialog(page)
    await dialog.getByLabel('커밋 메시지').fill('고침')
    await expect(dialog.getByRole('alert')).toHaveText('GitHub 파일이 바뀌었습니다. 당겨서 합친 뒤 푸시하세요')
    await dialog.getByRole('button', { name: '당기기…' }).click()
    await expect(page.locator('.notice-message', { hasText: 'GitHub 파일과 같습니다' })).toBeVisible()
    expect(requestsTo(server, '/synced')).toHaveLength(1)

    await openPush(page)
    await expect(pushDialog(page).getByLabel('커밋 메시지')).toHaveValue('고침')
    await expect(pushDialog(page).getByRole('alert')).toHaveCount(0)
    await pushDialog(page).getByRole('button', { name: '푸시', exact: true }).click()
    await expect.poll(() => requestsTo(server, '/push')).toHaveLength(1)
    expect(requestsTo(server, '/push')[0].body.message).toBe('고침')
  })
})

// F-2131 7장 — 저장소 그림 보이기·받아 넣기. 연결 경로 docs/README.md
const IMG_DOC = 'gh-img-doc'
const IMG_ATT = 'fedcba9876543210'
const SHA_P = 'a'.repeat(40)
// 위 PNG 는 <img> 는 그리지만 createImageBitmap 이 못 푼다 — toWebp·공개 첨부 확인용 2x2
const DECODABLE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR4nGM4AQYMEAoAQa4JYQOnncMAAAAASUVORK5CYII=', 'base64')

async function openImageDoc(page, room, { body, images = {}, github = {}, files = {} }) {
  const server = await fakeServer(page, {
    github: { enabled: true, connected: true, repos: ['o/r'], files: { 'o/r@main:docs/README.md': { sha: 'S1', bytes: body }, ...files }, ...github },
  })
  await room.install(page.context())
  const now = Date.now()
  server.docs.set(IMG_DOC, { id: IMG_DOC, title: '그림 문서', content: body, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now })
  server.githubLinks.set(IMG_DOC, {
    repo: 'o/r', branch: 'main', path: 'docs/README.md', remoteSha: 'S1', remoteBom: false, syncedAt: null, htmlUrl: 'https://github.com/o/r/blob/main/docs/README.md', images,
  })
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  return server
}

const naturalWidth = (locator) => locator.evaluate((img) => img.naturalWidth)

test.describe('F-2131 저장소 그림', () => {
  test('F-2131 E1 대응표가 늦게 와도 다른 입력 없이 그려진다 — 대응은 첨부, 나머지는 프록시, 원문 주소로는 요청하지 않는다', async ({ page }) => {
    const body = '시작\n\n![a](./img/a.png)\n\n![b](img/b.svg)\n\n![c](https://example.com/c.png)\n\n끝'
    const room = createFakeDocRoom()
    room.seed(IMG_DOC, { content: body, title: '그림 문서' })
    // 기능 꺼짐 — 연결 GET(F-2128)이 대응표를 먼저 채우지 않아 늦은 images 응답만으로 다시 그리는지 본다 (3.5 꺼짐 행)
    const server = await openImageDoc(page, room, { body, images: { 'docs/img/a.png': `${IMG_ATT}.png` }, github: { enabled: false, imagesDelayMs: 1500 } })
    server.attachments.set(`${IMG_ATT}.png`, { mime: 'image/png', bytes: PNG, width: 1, height: 1 })
    const urls = []
    page.on('request', (r) => urls.push(r.url()))

    await page.goto(`/#/d/${IMG_DOC}`)
    await expect(page.locator('.cm-content').first()).toContainText('시작')
    await expect(page.locator('.md-image')).toHaveCount(0)
    await expect(page.locator('.md-image')).toHaveCount(2)

    await expect(page.locator('[data-img-repo="docs/img/b.svg"] img')).toHaveAttribute('src', /\/api\/docs\/gh-img-doc\/github\/img\?path=docs%2Fimg%2Fb\.svg$/)
    const a = page.locator(`.md-image[data-img-id="${IMG_ATT}"] .md-image-img`)
    await expect.poll(() => naturalWidth(a)).toBeGreaterThan(0)
    expect(urls.filter((u) => u.includes('example.com'))).toEqual([])
    expect(urls.filter((u) => ['/img/a.png', '/docs/img/a.png'].includes(new URL(u).pathname))).toEqual([])
    expect(room.content(IMG_DOC)).toBe(body)
  })

  test('F-2131 E2 당기기가 같음으로 끝나면 png 만 받아 넣고, 그 줄은 첨부 그림으로 바뀐다', async ({ page }) => {
    const body = '시작\n\n![p](img/p.png)\n\n![s](img/s.svg)\n'
    const room = createFakeDocRoom()
    room.seed(IMG_DOC, { content: body, title: '그림 문서' })
    const server = await openImageDoc(page, room, {
      body,
      files: { 'o/r@main:docs/img/p.png': { sha: SHA_P, bytes: DECODABLE_PNG }, 'o/r@main:docs/img/s.svg': { sha: 'b'.repeat(40), bytes: '<svg xmlns="http://www.w3.org/2000/svg"/>' } },
    })
    const attachmentPuts = []
    page.on('request', (r) => {
      if (r.method() === 'PUT' && /\/api\/attachments\//.test(r.url())) attachmentPuts.push(new URL(r.url()).pathname)
    })
    await page.goto(`/#/d/${IMG_DOC}`)
    await expect(page.locator('[data-img-repo="docs/img/p.png"]')).toHaveCount(1)

    await startPull(page)
    await expect(page.locator('.notice-message', { hasText: 'GitHub 파일과 같습니다' })).toBeVisible()
    await expect.poll(() => requestsTo(server, '/images').filter((r) => r.method === 'PUT')).toHaveLength(1)

    expect(requestsTo(server, '/image-sources').map((r) => r.body)).toEqual([{ paths: ['docs/img/p.png', 'docs/img/s.svg'] }])
    expect(requestsTo(server, '/raw').map((r) => r.query.path)).toEqual(['docs/img/p.png'])
    expect(attachmentPuts).toHaveLength(1)
    expect(attachmentPuts[0]).toMatch(/^\/api\/attachments\/[0-9a-f]{16}\.(webp|png)$/)
    const put = requestsTo(server, '/images').find((r) => r.method === 'PUT')
    expect(put.body).toEqual({ path: 'docs/img/p.png', blobSha: SHA_P, attachment: attachmentPuts[0].split('/').pop() })

    const p = page.locator('.md-image[data-img-alt="p"]')
    await expect(p).not.toHaveAttribute('data-img-repo')
    await expect.poll(() => naturalWidth(p.locator('.md-image-img'))).toBeGreaterThan(0)
    expect(room.content(IMG_DOC)).toBe(body)
  })

  test('F-2131 E3 공개 문서 — 대응은 공개 첨부 주소, 나머지는 /gh 프록시, github 칸이 없으면 /gh 요청 0', async ({ page }) => {
    const content = '![a](img/a.png)\n\n![b](img/b.png)\n'
    const docs = {
      TOKGH: { title: '공개 그림', content, lineEnding: 'lf', updatedAt: 1, github: { path: 'README.md', images: { 'img/a.png': `${IMG_ATT}.png` } } },
      TOKNO: { title: '공개 그림 없음', content, lineEnding: 'lf', updatedAt: 1 },
    }
    const reqs = []
    await page.route(/\/pub\//, (route) => {
      const u = new URL(route.request().url())
      reqs.push(`${u.pathname}${u.search}`)
      const doc = docs[u.pathname.split('/')[3]]
      if (doc && u.pathname.split('/').length === 4) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) })
      if (u.pathname.endsWith(`/attachments/${IMG_ATT}.png`) || u.pathname.endsWith('/gh')) return route.fulfill({ status: 200, contentType: 'image/png', body: DECODABLE_PNG })
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
    })

    await page.goto('/#/p/TOKGH')
    await expect(page.locator('img[data-repo-path="img/b.png"]')).toHaveAttribute('src', '/pub/docs/TOKGH/gh?path=img%2Fb.png')
    await expect.poll(() => reqs).toContain(`/pub/docs/TOKGH/attachments/${IMG_ATT}.png`)
    await expect(page.locator(`img[data-attachment="${IMG_ATT}"]`)).toHaveAttribute('src', /^blob:/)

    await page.goto('about:blank')
    await page.goto('/#/p/TOKNO')
    await expect(page.locator('.public-view-title')).toHaveText('공개 그림 없음')
    await expect(page.locator('.viewer')).toContainText('이미지: b')
    expect(reqs.filter((r) => r.startsWith('/pub/docs/TOKNO') && r.includes('/gh'))).toEqual([])
  })
})
