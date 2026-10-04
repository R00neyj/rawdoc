// GitHub 연결·가져오기 화면 (specs/features/F-2128.md 7장)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

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
