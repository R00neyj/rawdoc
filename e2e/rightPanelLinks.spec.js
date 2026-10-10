// 오른쪽 패널 `링크` 보기 — 누르면 열기·끊긴 링크로 새 문서, 본문 입력 따라가기, 휴대폰 위 칸 보기 기억 (small 2026-10-11)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId } from './helpers.js'

const panel = (page) => page.getByRole('complementary', { name: '오른쪽 패널' })
const group = (page, title) => panel(page).locator('.doc-links-group').filter({ has: page.getByRole('heading', { name: new RegExp(`^${title}`) }) })

test('링크 보기 — 백링크를 누르면 그 문서가 열리고, 끊긴 나가는 링크를 누르면 그 제목으로 새 문서를 만든다', async ({ page }) => {
  await openApp(page)
  await importMarkdown(page, { name: '일지.md', content: '첫 줄\n오늘 [[회의]] 를 했다\n' })
  const journalId = await currentDocId(page)
  await importMarkdown(page, { name: '회의.md', content: '안건은 [[새 계획]] 에 적는다\n' })
  await expect(page.locator('.doc-title')).toHaveValue('회의')

  const backlink = group(page, '백링크').getByRole('button', { name: /일지/ })
  await expect(backlink).toContainText('오늘 [[회의]] 를 했다')
  await backlink.click()
  await expect.poll(() => currentDocId(page)).toBe(journalId)

  await group(page, '나가는 링크').getByRole('button', { name: '회의', exact: true }).click()
  await expect(page.locator('.doc-title')).toHaveValue('회의')
  await group(page, '나가는 링크').getByRole('button', { name: '새 계획, 끊긴 링크' }).click()
  await expect(page.locator('.doc-title')).toHaveValue('새 계획')
  await expect(page.locator('.sidebar .doc-item-btn', { hasText: '새 계획' })).toHaveCount(1)
})

test('링크 보기 — 본문에 위키링크를 넣으면 나가는 링크가 따라 바뀐다', async ({ page }) => {
  await openApp(page)
  await importMarkdown(page, { name: '계획.md', content: '내용\n' })
  await importMarkdown(page, { name: '메모.md', content: '첫 줄\n' })
  await expect(group(page, '나가는 링크').getByText('이 문서에는 위키링크가 없습니다.')).toBeVisible()

  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('[[계획]] 참고')
  await expect(group(page, '나가는 링크').getByRole('button', { name: '계획', exact: true })).toBeVisible()
})

test.describe('휴대폰 폭', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  async function swipeOpen(page) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 250, y: 400 }] })
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 250 - 30 * i, y: 400 }] })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(page.locator('.outline-panel')).toHaveAttribute('data-state', 'open')
  }

  test('링크 보기 — 위 칸을 다음 보기로 넘기면 링크가 보이고, 새로고침 뒤에도 그 보기다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '일지.md', content: '오늘 [[회의]] 를 했다\n' })
    await importMarkdown(page, { name: '회의.md', content: '내용\n' })

    await swipeOpen(page)
    const side = page.locator('.outline-panel')
    await side.getByRole('button', { name: '다음 보기' }).tap()
    await expect(side.getByRole('button', { name: '링크', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await expect(side.locator('.doc-link-item', { hasText: '일지' })).toBeVisible()

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await swipeOpen(page)
    await expect(side.getByRole('button', { name: '링크', exact: true })).toBeVisible()
    await expect(side.locator('.doc-link-item', { hasText: '일지' })).toBeVisible()
  })
})
