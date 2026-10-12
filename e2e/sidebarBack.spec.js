// 휴대폰 폭 겹침 사이드바 — 뒤로 가기로 닫기 (2026-10-12 small change)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, setPrefBeforeLoad, waitTransitionEnd } from './helpers.js'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

test('사이드바 뒤로가기: 뒤로 가기는 사이드바만 닫고, 바깥을 눌러 닫은 뒤의 뒤로 가기는 바로 이전 문서로 간다', async ({ page }) => {
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await openApp(page)
  const idA = await importMarkdown(page, { name: 'a.md', content: '가 본문\n' })
  const idB = await importMarkdown(page, { name: 'b.md', content: '나 본문\n' })
  const hashB = await page.evaluate(() => location.hash)
  const sidebar = page.locator('.sidebar')

  await page.getByRole('button', { name: '사이드바 열기' }).tap()
  await expect(sidebar).toHaveAttribute('data-state', 'open')
  await waitTransitionEnd(sidebar)
  await page.goBack()
  await expect(sidebar).not.toHaveAttribute('data-state', 'open')
  expect(await page.evaluate(() => location.hash)).toBe(hashB)
  expect(await currentDocId(page)).toBe(idB)

  await page.getByRole('button', { name: '사이드바 열기' }).tap()
  await expect(sidebar).toHaveAttribute('data-state', 'open')
  await waitTransitionEnd(sidebar)
  await page.locator('.sidebar-backdrop').click({ position: { x: 380, y: 400 } })
  await expect(sidebar).not.toHaveAttribute('data-state', 'open')
  await expect.poll(() => page.evaluate(() => history.state?.overlay ?? null)).toBe(null)
  await page.goBack()
  await expect.poll(() => currentDocId(page)).toBe(idA)
})
