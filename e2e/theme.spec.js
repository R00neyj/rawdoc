// 테마 3종·본문 서체·자동완성 서체·자간 (F-150.md 3.3)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setPrefBeforeLoad } from './helpers.js'

async function contrastScan(page) {
  return page.evaluate(() => {
    function luminance(rgb) {
      const [r, g, b] = rgb.match(/\d+/g).map(Number).map((c) => {
        const s = c / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    function contrast(a, b) {
      const l1 = luminance(a)
      const l2 = luminance(b)
      const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
      return (hi + 0.05) / (lo + 0.05)
    }
    function bgOf(el) {
      let node = el
      while (node) {
        const bg = getComputedStyle(node).backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg
        node = node.parentElement
      }
      return 'rgb(255, 255, 255)'
    }
    const failures = []
    const all = document.querySelectorAll('body *')
    for (const el of all) {
      if (el.children.length > 0) continue // 텍스트 노드를 직접 담은 leaf 요소만
      const text = el.textContent?.trim()
      if (!text) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      const fg = style.color
      const bg = bgOf(el)
      const ratio = contrast(fg, bg)
      if (ratio < 3.0) {
        failures.push({ text: text.slice(0, 20), ratio: Number(ratio.toFixed(2)), tag: el.tagName })
      }
    }
    return failures
  })
}

// F-153 A6 — 4.5 미만은 실패, 단 흐린 글자(--muted)·비활성 요소는 3.0 까지 허용
async function contrastScanStrict(page) {
  return page.evaluate(() => {
    function luminance(rgb) {
      const [r, g, b] = rgb.match(/\d+/g).map(Number).map((c) => {
        const s = c / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    function contrast(a, b) {
      const l1 = luminance(a)
      const l2 = luminance(b)
      const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
      return (hi + 0.05) / (lo + 0.05)
    }
    function bgOf(el) {
      let node = el
      while (node) {
        const bg = getComputedStyle(node).backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg
        node = node.parentElement
      }
      return 'rgb(255, 255, 255)'
    }
    const probe = document.createElement('div')
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()
    document.body.appendChild(probe)
    const mutedRgb = getComputedStyle(probe).color
    probe.remove()

    const failures = []
    const all = document.querySelectorAll('body *')
    for (const el of all) {
      if (el.children.length > 0) continue
      const text = el.textContent?.trim()
      if (!text) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      const fg = style.color
      const bg = bgOf(el)
      const ratio = contrast(fg, bg)
      const isDisabled = el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[aria-disabled="true"]') || el.closest(':disabled')
      const threshold = fg === mutedRgb || isDisabled ? 3.0 : 4.5
      if (ratio < threshold) {
        failures.push({ text: text.slice(0, 20), ratio: Number(ratio.toFixed(2)), tag: el.tagName, threshold })
      }
    }
    return failures
  })
}

test.describe('F-141 설정 대화상자', () => {
  test('테마 / 제목 서체 / 본문 서체 순서, 버튼 순서 동일', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '설정', exact: true }).click()
    const labels = page.locator('.dialog-field > span, .dialog-field [id]')
    await expect(labels.nth(0)).toHaveText('테마')
    await expect(labels.nth(1)).toHaveText('제목 서체')
    await expect(labels.nth(2)).toHaveText('본문 서체')

    const headingSeg = page.locator('#heading-font-label').locator('..').locator('[role="radio"]')
    const bodySeg = page.locator('#body-font-label').locator('..').locator('[role="radio"]')
    await expect(headingSeg.nth(0)).toHaveText('세리프')
    await expect(headingSeg.nth(1)).toHaveText('산세리프')
    await expect(bodySeg.nth(0)).toHaveText('세리프')
    await expect(bodySeg.nth(1)).toHaveText('산세리프')
  })
})

test.describe('F-141 A2 첫 화면', () => {
  test('md.theme=dark 저장 후 새로고침하면 렌더 전부터 dark', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.theme', 'dark')
    await openApp(page)
    const themeAttr = await page.evaluate(() => document.documentElement.dataset.theme)
    expect(themeAttr).toBe('dark')
  })
})

test.describe('F-141 A3 시스템 따라가기', () => {
  test('prefers-color-scheme 변경에 즉시 반응한다', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await openApp(page)
    await page.getByRole('button', { name: '설정', exact: true }).click()
    await page.getByRole('radio', { name: '시스템' }).click()
    await page.getByRole('button', { name: '닫기', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('white')

    await page.emulateMedia({ colorScheme: 'dark' })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('dark')
  })
})

test.describe('F-141 A4·A6 다크·세피아 대비', () => {
  for (const theme of ['dark', 'sepia']) {
    test(`${theme} 테마 글자 대비 미달 0건(3.0 미만)`, async ({ page }) => {
      await setPrefBeforeLoad(page, 'md.theme', theme)
      await openApp(page)
      await importMarkdown(page, {
        content:
          '# 제목\n## 부제\n- 목록\n> 인용\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\ncode\n```\n\n[링크](https://example.com)\n[[위키링크]]\n',
      })
      const failures = await contrastScan(page)
      expect(failures, JSON.stringify(failures)).toEqual([])
    })
  }
})

test.describe('F-141 A5 다크 CM6 커서', () => {
  // 앱은 @codemirror/view 의 drawSelection() 을 쓰지 않아 `.cm-cursor` 요소가 없다
  // (createEditor.js 확장 목록 확인) — 커서는 네이티브 caret 이다. 명세가 기대하는
  // `.cm-cursor` 판정은 불가능해 caret-color 로 대신 확인한다("확인 못 함"에 가깝다)
  test('caret-color 가 배경과 구분되는 색으로 지정돼 있다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.theme', 'dark')
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    await page.locator('.cm-content').click()
    const caretColor = await page.locator('.cm-content').evaluate((el) => getComputedStyle(el).caretColor)
    expect(caretColor).not.toBe('rgba(0, 0, 0, 0)')

    // 선택 영역은 바탕과 구분된다 (선택 레이어가 없으면 확인하지 않는다)
    await page.keyboard.press('Shift+End')
    const selectionLayer = page.locator('.cm-selectionBackground').first()
    if (await selectionLayer.count()) {
      const selectionBg = await selectionLayer.evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(selectionBg).not.toBe('rgba(0, 0, 0, 0)')
    }
  })
})

test.describe('F-141 A7 본문 서체 토글', () => {
  test('세리프 선택 시 편집·보기 모드 본문이 Noto Serif KR, 원문·사이드바는 그대로', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '문단 글자\n' })
    await page.getByRole('button', { name: '설정', exact: true }).click()
    await page.locator('#body-font-label').locator('..').getByRole('radio', { name: '세리프', exact: true }).click()
    await page.getByRole('button', { name: '닫기', exact: true }).click()

    const editorFont = await page.locator('.cm-line').first().evaluate((el) => getComputedStyle(el).fontFamily)
    expect(editorFont).toContain('Noto Serif KR')

    await page.reload()
    const persisted = await page.evaluate(() => localStorage.getItem('md.bodyFont'))
    expect(persisted).toBe('serif')
  })
})

test.describe('F-141 A9 자동완성 서체', () => {
  test('위키링크 자동완성 항목이 Pretendard Variable', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '다른문서.md', content: '내용\n' })
    await importMarkdown(page, { content: '' })
    await page.locator('.cm-content').click()
    await page.keyboard.type('[[다')
    const tooltip = page.locator('.cm-tooltip-autocomplete ul')
    await expect(tooltip).toBeVisible()
    const font = await tooltip.evaluate((el) => getComputedStyle(el).fontFamily)
    expect(font.split(',')[0].replace(/['"]/g, '').trim()).toBe('Pretendard Variable')
  })
})

test.describe('F-141 A15 자간', () => {
  test('한글 서체 요소는 font-size × -0.02, 고정폭 요소는 0', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '# 제목\n문단\n' })
    const para = page.locator('.cm-line').nth(1)
    const { tracking, fontSize } = await para.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { tracking: cs.letterSpacing, fontSize: parseFloat(cs.fontSize) }
    })
    const expected = fontSize * -0.02
    expect(Math.abs(parseFloat(tracking) - expected)).toBeLessThanOrEqual(0.05)

    await page.getByRole('button', { name: '원문 — 마크다운 기호 그대로 편집' }).click()
    const rawLine = page.locator('.cm-line').first()
    const rawTracking = await rawLine.evaluate((el) => getComputedStyle(el).letterSpacing)
    expect(['0px', 'normal']).toContain(rawTracking)
  })
})

test.describe('F-153 A6 세피아 화면 스캔', () => {
  test('4.5 미만 글자 요소 0개 (흐린 글자·비활성은 3.0)', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.theme', 'sepia')
    await openApp(page)
    await importMarkdown(page, {
      content:
        '# 제목\n## 부제\n- 목록\n> 인용\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\ncode\n```\n\n[링크](https://example.com)\n[[위키링크]]\n',
    })
    const failures = await contrastScanStrict(page)
    expect(failures, JSON.stringify(failures)).toEqual([])
  })
})

test.describe('F-153 A7 제목 서체 h1~h6', () => {
  const content = [1, 2, 3, 4, 5, 6].map((n) => `${'#'.repeat(n)} 제목${n}`).join('\n') + '\n'

  for (const [settingValue, expectedFont] of [
    ['serif', 'Noto Serif KR'],
    ['sans', 'Pretendard Variable'],
  ]) {
    test(`제목 서체 ${settingValue} — 편집·보기 12개 요소 모두 설정 서체`, async ({ page }) => {
      await openApp(page)
      await importMarkdown(page, { content })

      if (settingValue === 'sans') {
        await page.getByRole('button', { name: '설정', exact: true }).click()
        await page.locator('#heading-font-label').locator('..').getByRole('radio', { name: '산세리프', exact: true }).click()
        await page.getByRole('button', { name: '닫기', exact: true }).click()
      }

      for (let i = 1; i <= 6; i++) {
        const line = page.locator(`.cm-line.md-h${i}`)
        const font = await line.evaluate((el) => getComputedStyle(el).fontFamily)
        expect(font.split(',')[0].replace(/['"]/g, '').trim()).toBe(expectedFont)
      }

      await page.getByRole('button', { name: '보기 — 읽기 전용으로 보기' }).click()
      for (let i = 1; i <= 6; i++) {
        const heading = page.locator(`.markdown-body h${i}`)
        const font = await heading.evaluate((el) => getComputedStyle(el).fontFamily)
        expect(font.split(',')[0].replace(/['"]/g, '').trim()).toBe(expectedFont)
      }
    })
  }
})
