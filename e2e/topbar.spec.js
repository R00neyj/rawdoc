// 상단바 아이콘·툴팁·공유 메뉴 (F-150.md 3.3), 토글·검색 앞 묶음 (F-151)
// 버튼 크기·모서리·선택 바탕·머리 줄 배치·툴팁/메뉴 위치 같은 시각 값은 e2e 로 고정하지 않는다 (CLAUDE.md "How we work", 2026-09-25 e2e 경량화)
import { test, expect } from '@playwright/test'
import {
  openApp,
  importMarkdown,
  resizeWindow,
  rectOf,
  waitTransitionEnd,
  EXPORT_BUTTON_LABEL,
} from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const BUTTON_LABELS = [
  '편집 — 서식을 보며 편집',
  '원문 — 마크다운 기호 그대로 편집',
  '보기 — 읽기 전용으로 보기',
  '공유 — 링크·마크다운 복사',
  EXPORT_BUTTON_LABEL,
]

test.describe('F-142 상단바 버튼·툴팁', () => {
  test('F-142 A1 다섯 버튼 모두 아이콘만, 보이는 글자 없음', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    for (const label of BUTTON_LABELS) {
      const btn = page.getByRole('button', { name: label, exact: true })
      await expect(btn).toBeVisible()
      const svgCount = await btn.locator('svg').count()
      expect(svgCount).toBe(1)
      const text = (await btn.innerText()).trim()
      expect(text).toBe('')
    }
  })

  test('F-142 A3 모드 전환·내보내기 회귀 동작', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '# 제목\n' })

    const rawBtn = page.getByRole('button', { name: '원문 — 마크다운 기호 그대로 편집' })
    await rawBtn.click()
    await expect(rawBtn).toHaveAttribute('aria-pressed', 'true')

    const viewBtn = page.getByRole('button', { name: '보기 — 읽기 전용으로 보기' })
    await viewBtn.click()
    await expect(viewBtn).toHaveAttribute('aria-pressed', 'true')

    const liveBtn = page.getByRole('button', { name: '편집 — 서식을 보며 편집' })
    await liveBtn.click()
    await expect(liveBtn).toHaveAttribute('aria-pressed', 'true')
  })

  test('F-142 A5 빈 상태에서는 비활성이다', async ({ page }) => {
    await openApp(page)
    // 첫 실행 안내 문서가 있으므로 지워서 빈 상태를 만든다
    const row = page.locator('.tree-row').first()
    await row.hover()
    await row.locator('.item-menu-btn').click()
    await page.getByRole('menuitem', { name: /삭제/ }).click()
    await page.getByRole('button', { name: '삭제', exact: true }).click()

    await expect(page.getByRole('button', { name: '공유 — 링크·마크다운 복사' })).toBeDisabled()
    await expect(page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })).toBeDisabled()
  })
})

test.describe('F-142 A12 / F-142 3.6 공유 메뉴 가로 스크롤', () => {
  test('키보드 조작 — 방향키 이동, Enter 실행, Esc 로 닫기', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    const shareBtn = page.getByRole('button', { name: '공유 — 링크·마크다운 복사' })
    await shareBtn.click()
    const items = page.locator('.share-menu-list [role="menuitem"]')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('.share-menu-list')).toBeHidden()
    await expect(shareBtn).toBeFocused()
  })
})

// F-151 A1·A2·A5·A7 은 F-159 사이드바 머리 줄 위치로 옮겨 여기서 판정
test.describe('F-159 사이드바 전체 높이·머리 줄·너비 조절', () => {
  test('F-159 A5 (구 F-151 A5) 사이드바 머리 줄 — 펼침·레일에 있고 좁은 창엔 없다, 레일 위쪽 5개(검색·지도 포함)', async ({ page }) => {
    await openApp(page)
    await expect(page.locator('.sidebar-head')).toHaveCount(1)
    await expect(page.locator('.sidebar-scroll').getByRole('button', { name: /검색/ })).toHaveCount(0)

    await page.locator('.sidebar-toggle').click() // 레일로 접기
    await expect(page.locator('.sidebar-head--rail')).toHaveCount(1)
    const railButtons = page.locator('.sidebar-rail-scroll .rail-btn')
    await expect(railButtons).toHaveCount(5)
    await expect(railButtons.first()).toHaveAttribute('aria-label', '검색')
    await expect(railButtons.nth(1)).toHaveAttribute('aria-label', '새 문서')
    await expect(railButtons.nth(2)).toHaveAttribute('aria-label', '새 폴더')
    await expect(railButtons.nth(3)).toHaveAttribute('aria-label', '가져오기')
    await expect(railButtons.nth(4)).toHaveAttribute('aria-label', '지도') // F-292 가 더했다

    await page.locator('.sidebar-toggle').click() // 펼침으로
    await resizeWindow(page, 900)
    await page.locator('.sidebar-toggle').click() // 겹쳐 열기
    await expect(page.locator('.sidebar-head')).toHaveCount(0)
    await expect(page.locator('.sidebar').getByRole('button', { name: /검색/ })).toHaveCount(0)
  })

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
    await waitTransitionEnd(page.locator('.sidebar'))
    const sidebarRect = await rectOf(page.locator('.sidebar'))
    // 허용치는 같은 명세의 A5 들과 같은 2px — 기본값이 300 이 된 뒤 1.375px 어긋나 걸렸다 (2026-09-21)
    expect(Math.abs(sidebarRect.width - 332)).toBeLessThanOrEqual(2)

    await page.keyboard.press('ArrowLeft')
    await expect(handle).toHaveAttribute('aria-valuenow', '316')

    await page.reload()
    await expect(page.locator('.sidebar-resize-handle')).toHaveAttribute('aria-valuenow', '316')
  })
})

test.describe('F-151 상단바 앞 묶음(토글·검색)', () => {
  test('F-151 A3 토글 아이콘·aria-label·툴팁·aria-expanded·aria-controls (4 상태)', async ({ page }) => {
    await openApp(page)
    const toggle = page.locator('.sidebar-toggle')
    const wrap = page.locator('.icon-btn-wrap').filter({ has: toggle })
    const tooltip = wrap.locator('.icon-tooltip')

    // 1024px 이상, 펼침
    await expect(toggle).toHaveAttribute('aria-label', '사이드바 접기')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(toggle).toHaveAttribute('aria-controls', 'sidebar-nav')
    await expect(tooltip).toHaveText('사이드바 접기')

    // 1024px 이상, 레일
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', '사이드바 펴기')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(tooltip).toHaveText('사이드바 펴기')
    await toggle.click() // 펼침으로 되돌림

    // 1024px 미만, 닫힘
    await resizeWindow(page, 900)
    await expect(toggle).toHaveAttribute('aria-label', '사이드바 열기')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(tooltip).toHaveText('사이드바 열기')

    // 1024px 미만, 겹쳐 열림
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', '사이드바 닫기')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(tooltip).toHaveText('사이드바 닫기')
  })

  test('F-151 A4 좁은 창(900px) — 토글 하나로 열고 닫기, 바깥 클릭·Esc, md.sidebar 안 바뀜', async ({ page }) => {
    await openApp(page)
    await resizeWindow(page, 900)

    const prefBefore = await page.evaluate(() => window.localStorage.getItem('md.sidebar'))

    // 제품 아이콘 왼쪽에 다른 버튼이 없다 — topbar 의 첫 자식이 topbar-lead 다
    const firstChildClass = await page.evaluate(() => document.querySelector('.topbar').firstElementChild.className)
    expect(firstChildClass).toContain('topbar-lead')

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
  })

  // F-151 A6(검색 버튼 — 준비 중)은 F-287 로 대체됐다. 검색 버튼 동작은 e2e/docSearch.spec.js
})

test.describe('F-143 A10 그 밖의 기능 버튼 아이콘', () => {
  test('⋯ 메뉴·공유 메뉴 항목마다 아이콘 + 글자가 있다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '문서.md', content: '내용\n' })

    const row = page.locator('.tree-row').filter({ hasText: '문서' }).first()
    await row.hover()
    await row.locator('.item-menu-btn').click()
    const docMenuItems = page.locator('.item-menu-list [role="menuitem"]')
    const docCount = await docMenuItems.count()
    for (let i = 0; i < docCount; i++) {
      await expect(docMenuItems.nth(i).locator('svg')).toHaveCount(1)
    }
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    const shareItems = page.locator('.share-menu-list [role="menuitem"]')
    const shareCount = await shareItems.count()
    for (let i = 0; i < shareCount; i++) {
      await expect(shareItems.nth(i).locator('svg')).toHaveCount(1)
    }
  })
})

test.describe('F-163 공유 메뉴 `파일로 공유…` 제거', () => {
  test('F-163 A1 메뉴는 링크 복사·마크다운 복사 2개, ↓ 두 번이면 첫 항목으로 돌아옴', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()

    const items = page.locator('.share-menu-list [role="menuitem"]')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toHaveText('링크 복사')
    await expect(items.nth(1)).toHaveText('마크다운 복사')

    await expect(items.first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.first()).toBeFocused()
  })

  test('F-163 A2 10,000자 무작위 문서 링크 복사 — .md 내보내기 권장 문구', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)

    // deflate 로 잘 안 줄어들도록 넓은 문자 범위에서 무작위로 뽑는다 — `%`·`<` 는 주석(F-214)으로 잘려 링크가 짧아져 뺀다
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 !"#$&\'()*+,-./:;=>?@[\\]^_`{|}~'
    let content = ''
    for (let i = 0; i < 10_000; i++) {
      content += chars[Math.floor(Math.random() * chars.length)]
    }
    await importMarkdown(page, { content })

    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await page.getByRole('menuitem', { name: '링크 복사' }).click()

    const notice = page.locator('.notice--warn .notice-message')
    await expect(notice).toBeVisible()
    await expect(notice).toHaveText(/^링크가 깁니다\(약 \d+KB\)\. 일부 메신저에서 잘릴 수 있어 \.md 내보내기를 권장합니다\.$/)
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
