// 상단바 아이콘·툴팁·공유 메뉴 (F-150.md 3.3), 토글·검색 앞 묶음 (F-151)
// 버튼 크기·모서리·선택 바탕·머리 줄 배치·툴팁/메뉴 위치 같은 시각 값은 e2e 로 고정하지 않는다 (CLAUDE.md "How we work", 2026-09-25 e2e 경량화)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, resizeWindow } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

// F-151 A1·A2·A5·A7 은 F-159 사이드바 머리 줄 위치로 옮겨 여기서 판정
test.describe('F-159 사이드바 전체 높이·머리 줄·너비 조절', () => {
  test('F-159 A9 (구 F-151 A7) 포커스 순서 — 사이드바(토글→검색→…→너비 손잡이) → 상단바 → 편집 영역', async ({ page }) => {
    await openApp(page)
    const toggle = page.locator('.sidebar-toggle')
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(toggle).toBeFocused()

    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: '검색', exact: true })).toBeFocused()

    // 상단바(편집 모드 버튼) 바로 앞은 너비 손잡이(separator)이거나, 탭바(F-233, 기본
    // 켜짐)가 있으면 탭바 안이어야 한다 — 제목 입력은 빠졌다(F-217.md 2.5)
    let last = null
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      const isViewModeBtn = await page
        .getByRole('button', { name: '편집 — 서식을 보며 편집' })
        .evaluate((el) => el === document.activeElement)
      if (isViewModeBtn) break
      last = await page.evaluate(() => ({
        role: document.activeElement?.getAttribute('role'),
        inToolbar: !!document.activeElement?.closest('.editor-toolbar'),
      }))
    }
    await expect(page.getByRole('button', { name: '편집 — 서식을 보며 편집' })).toBeFocused()
    expect(last?.role === 'separator' || last?.inToolbar).toBe(true)

    await page.reload()
    const activeTag = await page.evaluate(() => document.activeElement?.tagName)
    expect(activeTag === 'BODY' || activeTag === undefined).toBe(true)
    const visibleTooltip = await page.locator('.icon-tooltip').evaluateAll((els) =>
      els.some((el) => parseFloat(getComputedStyle(el).opacity) > 0),
    )
    expect(visibleTooltip).toBe(false)
  })

  test('F-159 A6 더블클릭·키보드로 너비 조절', async ({ page }) => {
    await openApp(page)
    const handle = page.locator('.sidebar-resize-handle')
    await handle.dblclick()
    await expect(handle).toHaveAttribute('aria-valuenow', '300')

    await handle.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(handle).toHaveAttribute('aria-valuenow', '332')

    await page.keyboard.press('ArrowLeft')
    await expect(handle).toHaveAttribute('aria-valuenow', '316')

    await page.reload()
    await expect(page.locator('.sidebar-resize-handle')).toHaveAttribute('aria-valuenow', '316')
  })
})

test.describe('F-151 상단바 앞 묶음(토글·검색)', () => {
  test('F-151 A4 좁은 창(900px) — 토글 하나로 열고 닫기, 바깥 클릭·Esc, md.sidebar 안 바뀜, 넓히면 복귀', async ({ page }) => {
    await openApp(page)
    await resizeWindow(page, 900)

    const prefBefore = await page.evaluate(() => window.localStorage.getItem('md.sidebar'))

    const toggle = page.locator('.sidebar-toggle')
    await expect(page.locator('.sidebar')).toBeHidden()
    await toggle.click()
    await expect(page.locator('.sidebar')).toBeVisible()
    await toggle.click()
    await expect(page.locator('.sidebar')).toBeHidden()

    await toggle.click()
    await expect(page.locator('.sidebar')).toBeVisible()
    await page.mouse.click(700, 400) // 바깥(오른쪽) 클릭
    await expect(page.locator('.sidebar')).toBeHidden()

    await toggle.click()
    await expect(page.locator('.sidebar')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.sidebar')).toBeHidden()

    const prefAfter = await page.evaluate(() => window.localStorage.getItem('md.sidebar'))
    expect(prefAfter).toBe(prefBefore)

    // 넓히면 저장된 상태(펼침)로 돌아간다 (옛 layout.spec.js F-143 A5)
    await resizeWindow(page, 1280)
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--collapsed/)
  })

  // F-151 A6(검색 버튼 — 준비 중)은 F-287 로 대체됐다. 검색 버튼 동작은 e2e/docSearch.spec.js
})

// F-143 A10(메뉴 항목마다 아이콘)은 시각 값이라 뺐다 (CLAUDE.md "Design does not get TDD")

test.describe('F-163 공유 메뉴 `파일로 공유…` 제거', () => {
  test('F-163 A1 메뉴는 링크 복사·마크다운 복사 2개, ↓ 두 번이면 첫 항목으로 돌아옴, Esc 로 닫고 버튼 포커스', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()

    const items = page.locator('.share-menu-list [role="menuitem"]')

    await expect(items.first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.first()).toBeFocused()

    // Esc 로 닫히고 공유 버튼으로 포커스 복귀 (옛 F-142 A12·F-172 A5 를 합침)
    await page.keyboard.press('Escape')
    await expect(page.locator('.share-menu-list')).toBeHidden()
    await expect(page.getByRole('button', { name: '공유 — 링크·마크다운 복사' })).toBeFocused()
  })
})

test.describe('F-210 C 소유자 읽기 전용 링크 메뉴', () => {
  async function openServerDoc(page) {
    await openApp(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await page.locator('.cm-content').click()
    await page.keyboard.type('내용')
  }

  test('F-210 C1 항목 노출·발급·복사·끊기', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await fakeServer(page)
    let token = null
    await page.route(/\/api\/docs\/[^/]+\/link$/, async (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        if (!token) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no_link"}' })
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token }) })
      }
      if (req.method() === 'POST') {
        const created = !token
        if (!token) token = 'tok-abc'
        return route.fulfill({ status: created ? 201 : 200, contentType: 'application/json', body: JSON.stringify({ token }) })
      }
      if (req.method() === 'DELETE') {
        token = null
        return route.fulfill({ status: 204 })
      }
      return route.fallback()
    })

    await openServerDoc(page)
    const shareBtn = page.getByRole('button', { name: '공유 — 링크·마크다운 복사' })
    await shareBtn.click()
    await expect(page.locator('.share-menu-list [role="menuitem"]')).toHaveCount(4)
    await expect(page.getByRole('menuitem', { name: '읽기 전용 링크 복사' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '읽기 전용 링크 끊기' })).toHaveCount(0)

    await page.getByRole('menuitem', { name: '읽기 전용 링크 복사' }).click()
    await expect(page.locator('.notice--info .notice-message')).toHaveText(
      '읽기 전용 링크를 복사했습니다. 링크를 아는 사람은 로그인 없이 볼 수 있습니다.',
    )
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toContain('/p/tok-abc')

    await shareBtn.click()
    await expect(page.getByRole('menuitem', { name: '읽기 전용 링크 끊기' })).toBeVisible()
    await page.getByRole('menuitem', { name: '읽기 전용 링크 끊기' }).click()
    await expect(page.locator('.notice--info .notice-message')).toHaveText(
      '읽기 전용 링크를 끊었습니다. 이전 주소는 더 이상 열리지 않습니다.',
    )

    await shareBtn.click()
    await expect(page.getByRole('menuitem', { name: '읽기 전용 링크 끊기' })).toHaveCount(0)
  })

  test('F-210 C2 오프라인이면 만들지 못했다는 오류 알림', async ({ page }) => {
    await fakeServer(page)
    await page.route(/\/api\/docs\/[^/]+\/link$/, (route) => route.abort('internetdisconnected'))

    await openServerDoc(page)
    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await page.getByRole('menuitem', { name: '읽기 전용 링크 복사' }).click()
    await expect(page.locator('.notice--error .notice-message')).toHaveText(
      '링크를 만들지 못했습니다. 연결을 확인하세요.',
    )
  })
})
