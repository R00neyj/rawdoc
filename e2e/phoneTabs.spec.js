// 휴대폰 탭 — 하단 알약 탭 버튼과 탭 고르기 판 (small 2026-10-22, specs/wireframes/phone-tabs-flow.html)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, setPrefBeforeLoad } from './helpers.js'

const nav = (page) => page.getByRole('group', { name: '하단 도구' })
const sheet = (page) => page.getByRole('dialog', { name: '탭 고르기' })
const blurAll = (page) => page.evaluate(() => /** @type {HTMLElement | null} */ (document.activeElement)?.blur())

async function openSheet(page, count) {
  await blurAll(page)
  await nav(page).getByRole('button', { name: `탭 ${count}개`, exact: true }).tap()
  await expect(sheet(page)).toBeVisible()
}

test.describe('phone-tabs 휴대폰 탭 (390×844, 브라우저)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('phone-tabs A1 두 문서를 탭으로 열고 고르기 판에서 전환·닫기, 새로고침 뒤에도 탭이 남는다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    const idA = await importMarkdown(page, { name: '가.md', content: '가 본문\n' })
    const idB = await importMarkdown(page, { name: '나.md', content: '나 본문\n' })

    // 처음 빈 문서 탭을 × 로 닫으면 두 탭이 남는다
    await openSheet(page, 3)
    await sheet(page).getByRole('button', { name: '제목 없는 문서 탭 닫기' }).tap()
    await expect(sheet(page).locator('.phone-tab-card-title')).toHaveText(['가', '나'])
    await expect(sheet(page).getByRole('button', { name: '나', exact: true })).toHaveAttribute('aria-current', 'page')

    await sheet(page).getByRole('button', { name: '가', exact: true }).tap()
    await expect(sheet(page)).toBeHidden()
    await expect.poll(() => currentDocId(page)).toBe(idA)
    await expect(page.locator('.cm-content')).toContainText('가 본문')

    await page.reload()
    await expect(page.locator('.cm-content')).toContainText('가 본문')
    await openSheet(page, 2)
    await expect(sheet(page).locator('.phone-tab-card-title')).toHaveText(['가', '나'])

    // 지금 탭을 닫으면 이웃 탭으로 옮긴다
    await sheet(page).getByRole('button', { name: '가 탭 닫기' }).tap()
    await expect.poll(() => currentDocId(page)).toBe(idB)
    await expect(sheet(page).locator('.phone-tab-card-title')).toHaveText(['나'])
    await page.keyboard.press('Escape')
    await expect(sheet(page)).toBeHidden()
    await expect(nav(page).getByRole('button', { name: '탭 1개', exact: true })).toBeVisible()
    await expect(page.locator('.cm-content')).toContainText('나 본문')
  })
})
