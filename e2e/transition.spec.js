// 호버·툴팁 전환 전부 적용 (specs/features/F-149.md 3장)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, resizeWindow, waitTransitionEnd } from './helpers.js'

const EASE = 'cubic-bezier(0.51, 0.08, 0.5, 1.23)'
const DURATION = '0.18s'

// cubic-bezier(...) 값은 괄호 안에도 콤마가 있어 단순 split(',') 로 못 나눈다 — 괄호 깊이를 세어 최상위 콤마에서만 자른다
function splitTopLevel(value) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

// transition-property 목록에서 prop 을 찾아 duration·timing 이 공용 토큰과 같은지 잰다
async function expectColorTransition(locator, props) {
  const info = await locator.evaluate((el) => {
    const cs = getComputedStyle(el)
    return {
      properties: cs.transitionProperty,
      durations: cs.transitionDuration,
      timings: cs.transitionTimingFunction,
    }
  })
  const properties = splitTopLevel(info.properties)
  const durations = splitTopLevel(info.durations)
  const timings = splitTopLevel(info.timings)
  for (const prop of props) {
    const idx = properties.indexOf(prop)
    expect(idx, `${prop} 전환 없음 (가진 속성: ${properties.join(', ')})`).toBeGreaterThanOrEqual(0)
    expect(durations[idx], `${prop} duration`).toBe(DURATION)
    expect(timings[idx], `${prop} timing`).toBe(EASE)
  }
}

test.describe('F-149 A2 계산값 — 상단바·제목·설정', () => {
  test('상단바 아이콘 버튼·제목 입력·설정 세그먼트에 색 전환이 있다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    await expectColorTransition(page.getByRole('button', { name: '편집 — 서식을 보며 편집' }), [
      'background-color',
      'color',
    ])
    await expectColorTransition(page.locator('.doc-title'), ['background-color', 'border-color'])

    await page.getByRole('button', { name: '설정', exact: true }).click()
    const segBtn = page.locator('#theme-label').locator('..').getByRole('radio', { name: '시스템' })
    await expectColorTransition(segBtn, ['background-color', 'color'])
    await page.getByRole('button', { name: '닫기', exact: true }).click()

    const dialogBtn = page.locator('.dialog-actions button').first()
    // 대화상자 버튼 판정용 — 삭제 대화상자를 잠깐 연다
    const row = page.locator('.tree-row').first()
    await row.hover()
    await row.locator('.item-menu-btn').click()
    await page.getByRole('menuitem', { name: /삭제/ }).click()
    await expectColorTransition(dialogBtn, ['background-color'])
    await page.keyboard.press('Escape')
  })
})

test.describe('F-149 A2 계산값 — 사이드바', () => {
  test('사이드바 동작 버튼·레일 버튼·트리 행·토글·⋯ 버튼에 색 전환이 있다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '문서.md', content: '내용\n' })

    await expectColorTransition(page.getByRole('button', { name: '새 문서', exact: true }), [
      'background-color',
      'color',
    ])

    const row = page.locator('.tree-row').filter({ hasText: '문서' }).first()
    await expectColorTransition(row, ['background-color'])

    await row.hover()
    await expectColorTransition(row.locator('.item-menu-btn'), ['background-color', 'color', 'opacity'])
    await row.locator('.item-menu-btn').click()
    await expectColorTransition(page.locator('.item-menu-list button').first(), ['background-color', 'color'])
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: '새 폴더', exact: true }).click()
    await page.keyboard.press('Enter')
    const folderRow = page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') }).first()
    await expectColorTransition(folderRow.locator('.tree-toggle'), ['background-color', 'color'])

    await page.getByRole('button', { name: '사이드바 접기' }).click()
    await waitTransitionEnd(page.locator('.sidebar'))
    await expectColorTransition(page.locator('.rail-btn').first(), ['background-color', 'color'])
  })
})

test.describe('F-149 A2 계산값 — 공유·표·자동완성·목차', () => {
  test('공유 메뉴 항목·표 + 버튼·자동완성 항목·목차 항목에 색 전환이 있다', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, {
      name: '다른문서.md',
      content: '내용\n',
    })
    await importMarkdown(page, {
      content: '# 제목\n\n표\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n## 부제\n',
    })

    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await expectColorTransition(page.locator('.share-menu-list button').first(), ['background-color', 'color'])
    await page.keyboard.press('Escape')

    const wrap = page.locator('.md-table-widget')
    await wrap.hover()
    await expectColorTransition(wrap.locator('.md-table-add-col'), ['opacity', 'border-color', 'color'])

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n[[다')
    const item = page.locator('.cm-tooltip-autocomplete ul li').first()
    await expect(item).toBeVisible()
    await expectColorTransition(item, ['background-color', 'color'])
    await page.keyboard.press('Escape')

    const nav = page.locator('nav.outline')
    await nav.hover()
    await expect(nav).toHaveClass(/outline--expanded/)
    await expectColorTransition(page.locator('.outline-item').first(), ['background-color', 'color'])
  })
})

test.describe('F-149 A2 계산값 — 빈 상태', () => {
  test('빈 상태 버튼에 색 전환이 있다', async ({ page }) => {
    await openApp(page)
    const row = page.locator('.tree-row').first()
    await row.hover()
    await row.locator('.item-menu-btn').click()
    await page.getByRole('menuitem', { name: /삭제/ }).click()
    await page.getByRole('button', { name: '삭제', exact: true }).click()

    await expect(page.locator('.empty-state')).toBeVisible()
    await expectColorTransition(page.locator('.empty-state button').first(), ['background-color'])
  })
})

test.describe('F-149 A3 툴팁 전환·지연', () => {
  test('상단바 버튼 — 호버는 지연 뒤 나타나고, 포커스는 지연 없이, 사라짐도 지연 없다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    const btn = page.getByRole('button', { name: '.md 파일로 내보내기' })
    const wrap = page.locator('.icon-btn-wrap').filter({ has: btn })
    const tooltip = wrap.locator('.icon-tooltip')

    // hover() 는 실제 경과 시간을 예측할 수 없어 opacity 진행값 대신 정적 transition-delay 로 지연 유무를 잰다
    await btn.hover()
    const hoverDelay = await tooltip.evaluate((el) => getComputedStyle(el).transitionDelay)
    expect(hoverDelay).toBe('0.4s')
    await page.waitForTimeout(600) // 450ms·600ms 두 시점 모두 지난 뒤에도 보임
    await expect(tooltip).toHaveCSS('opacity', '1')

    await page.mouse.move(10, 10)
    const leaveDelay = await tooltip.evaluate((el) => getComputedStyle(el).transitionDelay)
    expect(leaveDelay).toBe('0s')
    await expect(tooltip).toHaveCSS('opacity', '0')

    await btn.focus()
    const focusDelay = await tooltip.evaluate((el) => getComputedStyle(el).transitionDelay)
    expect(focusDelay).toBe('0s')
    await expect(tooltip).toHaveCSS('opacity', '1', { timeout: 300 })
  })

  test('표 + 버튼 툴팁도 같은 지연 규칙을 따른다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '표\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n' })

    const wrap = page.locator('.md-table-widget')
    await wrap.hover()
    const addBtn = wrap.locator('.md-table-add-row')
    await addBtn.hover()
    const hoverDelay = await addBtn.evaluate((el) => getComputedStyle(el, '::after').transitionDelay)
    expect(hoverDelay).toBe('0.4s')
    await page.waitForTimeout(600)
    expect(Number(await addBtn.evaluate((el) => getComputedStyle(el, '::after').opacity))).toBe(1)

    await addBtn.focus()
    const focusDelay = await addBtn.evaluate((el) => getComputedStyle(el, '::after').transitionDelay)
    expect(focusDelay).toBe('0s')
    await expect
      .poll(async () => Number(await addBtn.evaluate((el) => getComputedStyle(el, '::after').opacity)))
      .toBe(1)
  })
})

test.describe('F-149 A4 기존 전환 유지', () => {
  test('사이드바 레일 폭·폴더 토글 회전 전환이 그대로 있다', async ({ page }) => {
    await openApp(page)
    const widthTransition = await page.locator('.sidebar').evaluate((el) => getComputedStyle(el).transitionProperty)
    expect(widthTransition.split(',').map((s) => s.trim())).toContain('width')

    await page.getByRole('button', { name: '새 폴더', exact: true }).click()
    await page.keyboard.press('Enter')
    const icon = page.locator('.tree-toggle-icon').first()
    const iconTransition = await icon.evaluate((el) => getComputedStyle(el).transitionProperty)
    expect(iconTransition.split(',').map((s) => s.trim())).toContain('transform')
  })
})

test.describe('F-149 A5 입력 반응 — 전환 제외', () => {
  test('CM6 커서·선택·줄, 표 칸 편집 하위 에디터 글자에는 전환이 없다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '문단\n\n표\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n' })

    // drawSelection() 을 안 써 .cm-cursor·.cm-selectionBackground 가 DOM 에 없다(e2e/theme.spec.js F-141 A5) — .cm-line 만 확인한다
    await page.locator('.cm-content').click()

    for (const selector of ['.cm-line']) {
      const duration = await page.locator(selector).first().evaluate((el) => getComputedStyle(el).transitionDuration)
      expect(duration.split(',').every((d) => d.trim() === '0s'), `${selector}: ${duration}`).toBe(true)
    }

    const cell = page.locator('.md-table td').first()
    await cell.click()
    const subEditorLine = page.locator('.md-table-cell-editing .cm-line').first()
    await expect(subEditorLine).toBeVisible()
    const duration = await subEditorLine.evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(duration.split(',').every((d) => d.trim() === '0s')).toBe(true)
  })
})

test.describe('F-149 A6 움직임 줄이기', () => {
  test('prefers-reduced-motion: reduce 이면 전환 시간이 0', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    const tokenValue = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--transition-fast').trim(),
    )
    expect(tokenValue).toBe('0ms')

    const btn = page.getByRole('button', { name: '편집 — 서식을 보며 편집' })
    const duration = await btn.evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(duration.split(',').every((d) => d.trim() === '0s')).toBe(true)

    const wrap = page.locator('.icon-btn-wrap').filter({ has: page.getByRole('button', { name: '.md 파일로 내보내기' }) })
    const tooltipDuration = await wrap
      .locator('.icon-tooltip')
      .evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(tooltipDuration).toBe('0s')
  })
})
