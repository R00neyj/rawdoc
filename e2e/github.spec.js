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

async function openLinkedDoc(page, room, { remote, syncedAt = null }) {
  const server = await fakeServer(page, { github: { enabled: true, connected: true, repos: ['o/r'], files: { 'o/r@main:doc.md': { sha: 'S2', bytes: remote } } } })
  await room.install(page.context())
  const now = Date.now()
  server.docs.set(PULL_DOC, { id: PULL_DOC, title: '당길 문서', content: BODY, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now })
  server.githubLinks.set(PULL_DOC, {
    repo: 'o/r', branch: 'main', path: 'doc.md', remoteSha: 'S1', remoteBom: false, syncedAt, htmlUrl: 'https://github.com/o/r/blob/main/doc.md', images: {},
  })
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
