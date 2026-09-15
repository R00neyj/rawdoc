// 대화상자 뒤 흐림·고정 폭 (specs/features/F-224.md)
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

async function openDeleteDialog(page) {
  await ensureSidebarOpen(page)
  const row = page.locator('.tree-row').first()
  await row.hover()
  await row.locator('.item-menu-btn').click()
  await page.getByRole('menuitem', { name: /삭제/ }).first().click()
  const dialog = page.locator('.dialog[open]')
  await waitTransitionEnd(dialog)
  return dialog
}

async function openSettingsDialog(page) {
  await ensureSidebarOpen(page)
  await page.getByRole('button', { name: '설정', exact: true }).first().click()
  const dialog = page.locator('.dialog[open]')
  await waitTransitionEnd(dialog)
  return dialog
}

async function openMoveDialog(page) {
  await ensureSidebarOpen(page)
  const row = page.locator('.tree-row').first()
  await row.hover()
  await row.locator('.item-menu-btn').click()
  await page.getByRole('menuitem', { name: '폴더로 이동…' }).first().click()
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

async function openApiTokensDialog(page) {
  await ensureSidebarOpen(page)
  await page.getByRole('button', { name: '계정' }).first().click()
  await page.getByRole('menuitem', { name: 'API 토큰' }).click()
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

test.describe('F-224 A1 뒤 막 흐림', () => {
  test('설정 대화상자를 연 상태에서 ::backdrop 에 blur(6px)', async ({ page }) => {
    await openApp(page)
    await openSettingsDialog(page)
    const backdropFilter = await page.evaluate(() => getComputedStyle(document.querySelector('dialog.dialog[open]'), '::backdrop').backdropFilter)
    expect(backdropFilter).toBe('blur(6px)')
  })
})

test.describe('F-224 A2 기본 폭', () => {
  test('D-1(짧은/긴 제목)·D-2·D-3 모두 420(±1)', async ({ page }) => {
    await resizeWindow(page, 1280, 800)
    await openApp(page)
    await importMarkdown(page, { name: '짧은.md', content: '내용\n' })

    const deleteDialog = await openDeleteDialog(page)
    await expect(deleteDialog).toBeVisible()
    let box = await deleteDialog.boundingBox()
    expect(box.width).toBeCloseTo(420, 0)
    await page.keyboard.press('Escape')

    const longTitle = '긴'.repeat(120)
    await importMarkdown(page, { name: `${longTitle}.md`, content: '내용\n' })
    const deleteDialog2 = await openDeleteDialog(page)
    await expect(deleteDialog2).toBeVisible()
    box = await deleteDialog2.boundingBox()
    expect(box.width).toBeCloseTo(420, 0)
    await page.keyboard.press('Escape')

    const settingsDialog = await openSettingsDialog(page)
    await expect(settingsDialog).toBeVisible()
    box = await settingsDialog.boundingBox()
    expect(box.width).toBeCloseTo(420, 0)
    await page.keyboard.press('Escape')

    const moveDialog = await openMoveDialog(page)
    await expect(moveDialog).toBeVisible()
    box = await moveDialog.boundingBox()
    expect(box.width).toBeCloseTo(420, 0)
    await page.keyboard.press('Escape')
  })
})

test.describe('F-224 A3 넓은 폭', () => {
  test('D-4(초대 0명/긴 이메일 1명)·D-5(토큰 0개/원문 표시 중) 모두 520(±1)', async ({ page }) => {
    await resizeWindow(page, 1280, 800)
    await fakeServer(page)
    await fakeGrants(page)
    await openApp(page)

    const inviteDialog = await openInviteDialog(page)
    await expect(inviteDialog).toBeVisible()
    let box = await inviteDialog.boundingBox()
    expect(box.width).toBeCloseTo(520, 0)

    const longEmail = `${'긴'.repeat(60)}@example.com`
    await inviteDialog.locator('.invite-email-input').fill(longEmail)
    await inviteDialog.getByRole('button', { name: '초대' }).click()
    await expect(inviteDialog.locator('.invite-grant-row')).toHaveCount(1)
    box = await inviteDialog.boundingBox()
    expect(box.width).toBeCloseTo(520, 0)
    await page.keyboard.press('Escape')

    const tokensDialog = await openApiTokensDialog(page)
    await expect(tokensDialog).toBeVisible()
    box = await tokensDialog.boundingBox()
    expect(box.width).toBeCloseTo(520, 0)

    await tokensDialog.locator('.api-token-name-input').fill('원문 표시 중 토큰')
    await tokensDialog.getByRole('button', { name: '토큰 만들기' }).click()
    await expect(tokensDialog.locator('.api-token-value')).toBeVisible()
    box = await tokensDialog.boundingBox()
    expect(box.width).toBeCloseTo(520, 0)
  })
})

test.describe('F-224 A4 좁은 창', () => {
  test('400x800 에서 D-2·D-4 모두 368(±1)', async ({ page }) => {
    await fakeServer(page)
    await fakeGrants(page)
    await openApp(page)
    await resizeWindow(page, 400, 800)
    await expect(page.locator('.sidebar')).toHaveClass(/sidebar--overlay/)

    const settingsDialog = await openSettingsDialog(page)
    await expect(settingsDialog).toBeVisible()
    let box = await settingsDialog.boundingBox()
    expect(box.width).toBeCloseTo(368, 0)
    await page.keyboard.press('Escape')
    // 겹침 사이드바가 열린 채면 배경 막이 공유 버튼 클릭을 가로챈다 — 먼저 닫는다
    const backdrop = page.locator('.sidebar-backdrop')
    if (await backdrop.count()) {
      await backdrop.click()
      await expect(backdrop).toHaveCount(0)
    }

    const inviteDialog = await openInviteDialog(page)
    await expect(inviteDialog).toBeVisible()
    box = await inviteDialog.boundingBox()
    expect(box.width).toBeCloseTo(368, 0)
  })
})
