// 좁은 창 가로 넘침 (specs/features/F-224.md A4, F-225 A7, F-217 A7)
// 대화상자 폭 420/520/368, 뒤 막 blur 같은 시각 값은 e2e 로 고정하지 않는다 (CLAUDE.md "How we work", 2026-09-25 e2e 경량화).
// 세 파일에 흩어져 있던 좁은 창 넘침 확인을 이 테스트 하나로 합쳤다
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, resizeWindow, waitTransitionEnd } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

// 겹침 사이드바(좁은 창)면 먼저 펴서 안의 버튼이 보이게 한다 — narrow 클래스가 붙을 때까지 기다린 뒤 판단한다(리사이즈 직후 React 반영 지연 대비)
async function ensureSidebarOpen(page) {
  const sidebar = page.locator('.sidebar')
  const isOverlay = await sidebar.evaluate((el) => el.classList.contains('sidebar--overlay'))
  if (!isOverlay) return
  if ((await sidebar.getAttribute('data-state')) === 'open') return
  await page.locator('.sidebar-toggle').first().click()
  await expect(sidebar).toHaveAttribute('data-state', 'open')
  await waitTransitionEnd(sidebar)
}

async function openSettingsDialog(page) {
  await ensureSidebarOpen(page)
  await page.getByRole('button', { name: '설정', exact: true }).first().click()
  const dialog = page.locator('.dialog[open]')
  await waitTransitionEnd(dialog)
  return dialog
}

async function openInviteDialog(page) {
  await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).first().click()
  await page.getByRole('menuitem', { name: '사람 초대…' }).click()
  const dialog = page.locator('.dialog[open]')
  await waitTransitionEnd(dialog)
  return dialog
}

async function fakeGrants(page) {
  const grants = []
  await page.route(/\/api\/docs\/[^/]+\/grants$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(grants) })
  })
  await page.route(/\/api\/docs\/[^/]+\/grants\/[^/]+$/, async (route) => {
    const req = route.request()
    if (req.method() === 'PUT') {
      const email = decodeURIComponent(new URL(req.url()).pathname.split('/').pop())
      const body = req.postDataJSON()
      grants.push({ email, role: body.role, createdAt: Date.now() })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email, role: body.role }) })
    }
    return route.fallback()
  })
}

async function expectNoHorizontalOverflow(page, where) {
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement.scrollWidth,
    clientWidth: document.scrollingElement.clientWidth,
  }))
  expect(sizes.scrollWidth, where).toBeLessThanOrEqual(sizes.clientWidth)
}

test.describe('좁은 창 가로 넘침 (F-224 A4·F-225 A7·F-217 A7)', () => {
  test('400px 창 — 긴 제목, 설정 대화상자, 초대 대화상자 모두 가로 스크롤 없음', async ({ page }) => {
    await fakeServer(page)
    await fakeGrants(page)
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await resizeWindow(page, 400, 800)
    await expect(page.locator('.sidebar')).toHaveClass(/sidebar--overlay/)

    await page.locator('.doc-title').fill('아주 아주 아주 아주 아주 아주 아주 아주 긴 제목이 줄바꿈 되는지 확인합니다')
    await expectNoHorizontalOverflow(page, '긴 제목')

    const settingsDialog = await openSettingsDialog(page)
    await expect(settingsDialog).toBeVisible()
    await expectNoHorizontalOverflow(page, '설정 대화상자')
    expect(await settingsDialog.evaluate((el) => el.offsetWidth)).toBeLessThanOrEqual(400)
    await page.keyboard.press('Escape')
    // 겹침 사이드바가 열린 채면 배경 막이 공유 버튼 클릭을 가로챈다 — 먼저 닫는다
    const backdrop = page.locator('.sidebar-backdrop')
    if (await backdrop.count()) {
      await backdrop.click()
      await expect(backdrop).toHaveCount(0)
    }

    const inviteDialog = await openInviteDialog(page)
    await expect(inviteDialog).toBeVisible()
    await expectNoHorizontalOverflow(page, '초대 대화상자')
    expect(await inviteDialog.evaluate((el) => el.offsetWidth)).toBeLessThanOrEqual(400)
  })
})
