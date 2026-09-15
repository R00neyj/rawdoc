// 상단바 아이콘·툴팁·공유 메뉴 (F-150.md 3.3), 토글·검색 앞 묶음 (F-151)
import { test, expect } from '@playwright/test'
import {
  openApp,
  importMarkdown,
  resizeWindow,
  rectOf,
  waitTransitionEnd,
  currentDocId,
  setPrefBeforeLoad,
} from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

// 배경이 반투명일 수 있어 부모를 거슬러 올라가 첫 불투명 바탕과 합성한 뒤 대비를 잰다 (F-153 A1)
async function selectedContrast(locator) {
  return locator.evaluate((el) => {
    // 정규식 대신 canvas 로 실제 픽셀 값을 읽는다 — 어떤 CSS 색 표기든 처리된다
    function toRgba(str) {
      const canvas = toRgba.canvas ?? (toRgba.canvas = document.createElement('canvas'))
      canvas.width = 1
      canvas.height = 1
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = str
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      return { r, g, b, a: a / 255 }
    }
    function luminance({ r, g, b }) {
      const [rl, gl, bl] = [r, g, b].map((c) => {
        const s = c / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
    }
    function contrast(a, b) {
      const l1 = luminance(a)
      const l2 = luminance(b)
      const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
      return (hi + 0.05) / (lo + 0.05)
    }
    function opaqueBg(node) {
      let n = node.parentElement
      while (n) {
        const rgba = toRgba(getComputedStyle(n).backgroundColor)
        if (rgba.a === 1) return rgba
        n = n.parentElement
      }
      return { r: 255, g: 255, b: 255, a: 1 }
    }
    const cs = getComputedStyle(el)
    const fg = toRgba(cs.color)
    const overlay = toRgba(cs.backgroundColor)
    const under = opaqueBg(el)
    const blended = {
      r: overlay.r * overlay.a + under.r * (1 - overlay.a),
      g: overlay.g * overlay.a + under.g * (1 - overlay.a),
      b: overlay.b * overlay.a + under.b * (1 - overlay.a),
    }
    return contrast(fg, blended)
  })
}

// 임의의 CSS 색 표기(rgb()/color(srgb ...) 등)를 canvas 로 읽어 실제 rgba 값을 얻는다
async function colorOf(locator, prop = 'backgroundColor') {
  return locator.evaluate((el, p) => {
    const cs = getComputedStyle(el)
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = cs[p]
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return { r, g, b, a: a / 255 }
  }, prop)
}

const BUTTON_LABELS = [
  '편집 — 서식을 보며 편집',
  '원문 — 마크다운 기호 그대로 편집',
  '보기 — 읽기 전용으로 보기',
  '공유 — 링크·마크다운 복사',
  '.md 파일로 내보내기',
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

  for (const width of [1280, 1024]) {
    test(`F-142 A2 창 너비 ${width}px 에서 툴팁이 창 안에 있다`, async ({ page }) => {
      await openApp(page)
      await importMarkdown(page, { content: '내용\n' })
      await resizeWindow(page, width)
      const exportBtn = page.getByRole('button', { name: '.md 파일로 내보내기' })
      await exportBtn.hover()
      await page.waitForTimeout(450) // 3.2 "400ms 뒤 표시" — 지연 자체를 확인하는 자리라 고정 대기
      const tooltipRect = await exportBtn.evaluate((el) => {
        const cs = getComputedStyle(el, '::after')
        const r = el.getBoundingClientRect()
        return { opacity: cs.opacity, right: r.right + (parseFloat(cs.width) || 0) }
      })
      expect(Number(tooltipRect.opacity)).toBeGreaterThan(0)
      const scrollWidth = await page.evaluate(() => document.scrollingElement.scrollWidth)
      const clientWidth = await page.evaluate(() => document.scrollingElement.clientWidth)
      expect(scrollWidth).toBe(clientWidth)
    })
  }

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
    await expect(page.getByRole('button', { name: '.md 파일로 내보내기' })).toBeDisabled()
  })
})

test.describe('F-142 A12 / F-142 3.6 공유 메뉴 가로 스크롤', () => {
  for (const width of [1280, 1024]) {
    test(`창 너비 ${width}px 에서 공유 메뉴가 창 안에 있다`, async ({ page }) => {
      await openApp(page)
      await importMarkdown(page, { content: '내용\n' })
      await resizeWindow(page, width)
      const shareBtn = page.getByRole('button', { name: '공유 — 링크·마크다운 복사' })
      await shareBtn.click()
      const menu = page.locator('.share-menu-list')
      await expect(menu).toBeVisible()

      const menuRect = await rectOf(menu)
      const btnRect = await rectOf(shareBtn)
      expect(Math.abs(menuRect.right - btnRect.right)).toBeLessThanOrEqual(2)
      expect(menuRect.left).toBeGreaterThanOrEqual(0)

      const scrollWidth = await page.evaluate(() => document.scrollingElement.scrollWidth)
      const clientWidth = await page.evaluate(() => document.scrollingElement.clientWidth)
      expect(scrollWidth).toBe(clientWidth)

      await page.keyboard.press('Escape')
    })
  }

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
  test('F-159 A3 (구 F-151 A1) 머리 줄 배치 — 1600×900, 펼침', async ({ page }) => {
    await openApp(page)
    const head = page.locator('.sidebar-head')
    await expect(head).toHaveCount(1)
    const search = page.getByRole('button', { name: '검색 — 준비 중' })
    const toggle = page.getByRole('button', { name: '사이드바 접기' })
    const sidebar = page.locator('.sidebar')
    const brandIcon = page.locator('.brand-icon')
    const topbar = page.locator('.topbar')

    const brandRect = await rectOf(brandIcon)
    expect(Math.abs(brandRect.left - 14)).toBeLessThanOrEqual(1)

    const searchRect = await rectOf(search)
    const sidebarRect = await rectOf(sidebar)
    expect(Math.abs(sidebarRect.right - 8 - searchRect.right)).toBeLessThanOrEqual(1)

    const toggleRect = await rectOf(toggle)
    expect(toggleRect.right).toBeLessThanOrEqual(searchRect.left + 1)
    expect(brandRect.left).toBeLessThan(toggleRect.left)

    const headRect = await rectOf(head)
    const topbarRect = await rectOf(topbar)
    expect(Math.abs((headRect.top + headRect.bottom) / 2 - (topbarRect.top + topbarRect.bottom) / 2)).toBeLessThanOrEqual(1)

    const newDocBtn = page.getByRole('button', { name: '새 문서', exact: true })
    const newDocRect = await rectOf(newDocBtn)
    expect(newDocRect.top).toBeGreaterThanOrEqual(headRect.bottom - 1)
  })

  test('F-159 A2 사이드바 전체 높이 — 사이드바 윗변 0, 아랫변 창 높이, 상단바에 제품명·토글 없음', async ({ page }) => {
    await openApp(page)
    const sidebar = page.locator('.sidebar')
    const sidebarRect = await rectOf(sidebar)
    expect(Math.abs(sidebarRect.top - 0)).toBeLessThanOrEqual(1)
    const viewportHeight = await page.evaluate(() => window.innerHeight)
    expect(Math.abs(sidebarRect.bottom - viewportHeight)).toBeLessThanOrEqual(1)

    const topbar = page.locator('.topbar')
    const topbarRect = await rectOf(topbar)
    expect(Math.abs(topbarRect.left - sidebarRect.right)).toBeLessThanOrEqual(1)
    await expect(topbar.locator('.brand')).toHaveCount(0)
    await expect(topbar.locator('.sidebar-toggle')).toHaveCount(0)
  })

  test('F-159 A4 (구 F-151 A2) 레일 머리 줄 — 토글만 가운데, 제품명 숨김, 상단바 왼쪽 48px', async ({ page }) => {
    await openApp(page)
    const toggle = page.getByRole('button', { name: '사이드바 접기' })
    await toggle.click()
    await waitTransitionEnd(page.locator('.sidebar'))

    const sidebar = page.locator('.sidebar')
    await expect(sidebar).toHaveClass(/sidebar--collapsed/)
    const sidebarRect = await rectOf(sidebar)
    expect(Math.abs(sidebarRect.width - 48)).toBeLessThanOrEqual(1)

    await expect(page.locator('.brand')).toBeHidden() // 토글 버튼 노드를 유지하려고 hidden 속성만 준다 (F-151 2.2)
    const railHead = page.locator('.sidebar-head--rail')
    await expect(railHead).toHaveCount(1)
    const openToggle = page.getByRole('button', { name: '사이드바 펴기' })
    const toggleRect = await rectOf(openToggle)
    const headRect = await rectOf(railHead)
    expect(Math.abs((toggleRect.left + toggleRect.right) / 2 - (headRect.left + headRect.right) / 2)).toBeLessThanOrEqual(1)

    const topbar = page.locator('.topbar')
    const topbarRect = await rectOf(topbar)
    expect(Math.abs(topbarRect.left - 48)).toBeLessThanOrEqual(1)

    await page.reload()
    const sidebarAfterReload = page.locator('.sidebar')
    await expect(sidebarAfterReload).toHaveClass(/sidebar--collapsed/)
    const sidebarRect2 = await rectOf(sidebarAfterReload)
    expect(Math.abs(sidebarRect2.width - 48)).toBeLessThanOrEqual(1)
  })

  test('F-159 A5 (구 F-151 A5) 사이드바 머리 줄 — 펼침·레일에 있고 좁은 창엔 없다, 레일 위쪽 4개(검색 포함)', async ({ page }) => {
    await openApp(page)
    await expect(page.locator('.sidebar-head')).toHaveCount(1)
    await expect(page.locator('.sidebar-scroll').getByRole('button', { name: /검색/ })).toHaveCount(0)

    await page.locator('.sidebar-toggle').click() // 레일로 접기
    await expect(page.locator('.sidebar-head--rail')).toHaveCount(1)
    const railButtons = page.locator('.sidebar-rail-scroll .rail-btn')
    await expect(railButtons).toHaveCount(4)
    await expect(railButtons.first()).toHaveAttribute('aria-label', '검색 — 준비 중')
    await expect(railButtons.nth(1)).toHaveAttribute('aria-label', '새 문서')
    await expect(railButtons.nth(2)).toHaveAttribute('aria-label', '새 폴더')
    await expect(railButtons.nth(3)).toHaveAttribute('aria-label', '가져오기')

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
    await expect(page.getByRole('button', { name: '검색 — 준비 중' })).toBeFocused()

    // 너비 손잡이 바로 다음 포커스가 상단바(편집 모드 버튼)인지 — 제목 입력이 빠졌다 (F-217.md 2.5)
    let lastRole = null
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab')
      const isViewModeBtn = await page
        .getByRole('button', { name: '편집 — 서식을 보며 편집' })
        .evaluate((el) => el === document.activeElement)
      if (isViewModeBtn) break
      lastRole = await page.evaluate(() => document.activeElement?.getAttribute('role'))
    }
    await expect(page.getByRole('button', { name: '편집 — 서식을 보며 편집' })).toBeFocused()
    expect(lastRole).toBe('separator')

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
    await expect(handle).toHaveAttribute('aria-valuenow', '224')

    await handle.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(handle).toHaveAttribute('aria-valuenow', '256')
    await waitTransitionEnd(page.locator('.sidebar'))
    const sidebarRect = await rectOf(page.locator('.sidebar'))
    expect(Math.abs(sidebarRect.width - 256)).toBeLessThanOrEqual(1)

    await page.keyboard.press('ArrowLeft')
    await expect(handle).toHaveAttribute('aria-valuenow', '240')

    await page.reload()
    await expect(page.locator('.sidebar-resize-handle')).toHaveAttribute('aria-valuenow', '240')
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

  test('F-151 A6 검색 버튼 — 클릭·Enter 해도 아무 변화 없음', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    const search = page.getByRole('button', { name: '검색 — 준비 중' })
    await expect(search).toHaveAttribute('aria-disabled', 'true')

    const docIdBefore = await currentDocId(page)
    const docCountBefore = await page.locator('.tree-row').count()
    const urlBefore = page.url()

    await search.click({ force: true }) // aria-disabled='true' 라 Playwright 기본 클릭 판정을 우회한다
    await search.focus()
    await page.keyboard.press('Enter')

    expect(await currentDocId(page)).toBe(docIdBefore)
    expect(await page.locator('.tree-row').count()).toBe(docCountBefore)
    expect(page.url()).toBe(urlBefore)
    await expect(search).toBeFocused()
  })

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

test.describe('F-153 A1 상단바 아이콘 버튼', () => {
  for (const theme of ['white', 'sepia', 'dark']) {
    test(`${theme} — 테두리 없음, 32x32, 모서리 6px, 선택 표시 대비 4.5 이상`, async ({ page }) => {
      await setPrefBeforeLoad(page, 'md.theme', theme)
      await openApp(page)
      await importMarkdown(page, { content: '내용\n' })

      const buttons = page.locator('.sidebar-head .icon-btn, .topbar .icon-btn')
      await expect(buttons).toHaveCount(8) // 토글·검색·보기모드 3개·공유·내보내기·계정
      const count = await buttons.count()
      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i)
        const box = await rectOf(btn)
        expect(Math.abs(box.width - 32)).toBeLessThanOrEqual(1)
        expect(Math.abs(box.height - 32)).toBeLessThanOrEqual(1)
        const style = await btn.evaluate((el) => {
          const cs = getComputedStyle(el)
          return { borderWidth: cs.borderTopWidth, radius: cs.borderTopLeftRadius }
        })
        expect(style.borderWidth).toBe('0px')
        expect(style.radius).toBe('6px')
      }

      // 기본 모드는 편집(live) 이라 선택 상태다 — 비선택 버튼은 보기 모드로 확인한다
      const viewBtn = page.getByRole('button', { name: '보기 — 읽기 전용으로 보기' })
      expect((await colorOf(viewBtn)).a).toBe(0)

      // 선택 버튼 — 원문 모드로 바꾼 뒤 대비 확인
      const liveBtn = page.getByRole('button', { name: '편집 — 서식을 보며 편집' })
      const rawBtn = page.getByRole('button', { name: '원문 — 마크다운 기호 그대로 편집' })
      await rawBtn.click()
      await expect(rawBtn).toHaveAttribute('aria-pressed', 'true')
      // 색 전환(F-149)이 끝난 값을 읽는다
      await Promise.all([waitTransitionEnd(rawBtn), waitTransitionEnd(liveBtn)])
      expect((await colorOf(rawBtn)).a).toBeGreaterThan(0)
      // 방금 선택이 풀린 편집 버튼은 다시 투명이어야 한다
      expect((await colorOf(liveBtn)).a).toBe(0)
      const ratio = await selectedContrast(rawBtn)
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })
  }
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
    expect(clip).toContain('#/p/tok-abc')

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

test.describe('F-153 A2 설정 세그먼트 선택 표시', () => {
  test('아이콘 버튼 선택 표시와 같은 바탕, 검은 칠 없음', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '설정', exact: true }).click()
    const selected = page.locator('#theme-label').locator('..').getByRole('radio', { name: '시스템' })
    await selected.click()
    await expect(selected).toHaveAttribute('aria-checked', 'true')
    await waitTransitionEnd(selected)
    const segStyle = await selected.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { bg: cs.backgroundColor, color: cs.color, weight: cs.fontWeight }
    })
    expect(segStyle.weight).toBe('600')
    // 검은 칠(불투명 --ink 바탕)이 아니라 반투명 섞음이어야 한다
    const segAlpha = (await colorOf(selected)).a
    expect(segAlpha).toBeGreaterThan(0)
    expect(segAlpha).toBeLessThan(1)

    await page.getByRole('button', { name: '닫기', exact: true }).click()
    const rawBtn = page.getByRole('button', { name: '원문 — 마크다운 기호 그대로 편집' })
    await rawBtn.click()
    await waitTransitionEnd(rawBtn)
    const iconStyle = await rawBtn.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { bg: cs.backgroundColor, color: cs.color }
    })
    expect(segStyle.bg).toBe(iconStyle.bg)
    expect(segStyle.color).toBe(iconStyle.color)
  })
})
