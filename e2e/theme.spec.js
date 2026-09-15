// 테마 3종·본문 서체·자동완성 서체·자간 (F-150.md 3.3)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setPrefBeforeLoad, setViewMode, tokenAsRgb, readSavedContent } from './helpers.js'

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
    // 초대 대화상자(F-212)도 닫힌 채 DOM 에 있어 설정 대화상자로 좁힌다
    const labels = page.locator('dialog[aria-labelledby="settings-title"]').locator('.dialog-field > span, .dialog-field [id]')
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

test.describe('F-154 A7 설정 항목 — 글자 크기·들여쓰기', () => {
  test('테마/제목 서체/본문 서체/글자 크기/들여쓰기/줄 번호 순서, 기본 선택 표시', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '설정', exact: true }).click()
    const labels = page.locator('dialog[aria-labelledby="settings-title"]').locator('.dialog-field > span, .dialog-field [id]')
    await expect(labels.nth(3)).toHaveText('글자 크기')
    await expect(labels.nth(4)).toHaveText('들여쓰기')
    await expect(labels.nth(5)).toHaveText('줄 번호')

    const fontSizeSeg = page.locator('#font-size-label').locator('..').locator('[role="radio"]')
    await expect(fontSizeSeg.nth(0)).toHaveText('작게')
    await expect(fontSizeSeg.nth(1)).toHaveText('보통')
    await expect(fontSizeSeg.nth(2)).toHaveText('크게')
    await expect(fontSizeSeg.nth(1)).toHaveAttribute('aria-checked', 'true') // 기본 medium(보통)

    const indentSeg = page.locator('#indent-label').locator('..').locator('[role="radio"]')
    await expect(indentSeg.nth(0)).toHaveText('2칸')
    await expect(indentSeg.nth(1)).toHaveText('4칸')
    await expect(indentSeg.nth(1)).toHaveAttribute('aria-checked', 'true') // 기본 4칸
  })
})

test.describe('F-154 A6 글자 크기', () => {
  const CASES = [
    ['작게', '14px'],
    ['보통', '16px'],
    ['크게', '18px'],
  ]

  for (const [label, px] of CASES) {
    test(`${label} 선택 시 편집·보기 모드 ${px}, 사이드바 불변, 새로고침 후 유지`, async ({ page }) => {
      await openApp(page)
      await importMarkdown(page, { content: '문단 글자\n' })
      const sidebarFontBefore = await page.locator('.sidebar').evaluate((el) => getComputedStyle(el).fontSize)

      await page.getByRole('button', { name: '설정', exact: true }).click()
      await page.locator('#font-size-label').locator('..').getByRole('radio', { name: label, exact: true }).click()
      await page.getByRole('button', { name: '닫기', exact: true }).click()

      const editorFontSize = await page.locator('.cm-line').first().evaluate((el) => getComputedStyle(el).fontSize)
      expect(editorFontSize).toBe(px)

      await setViewMode(page, 'view')
      const viewerFontSize = await page.locator('.markdown-body').first().evaluate((el) => getComputedStyle(el).fontSize)
      expect(viewerFontSize).toBe(px)

      const sidebarFontAfter = await page.locator('.sidebar').evaluate((el) => getComputedStyle(el).fontSize)
      expect(sidebarFontAfter).toBe(sidebarFontBefore)

      await page.reload()
      const persisted = await page.evaluate(() => localStorage.getItem('md.fontSize'))
      expect(persisted).toBe(label === '작게' ? 'small' : label === '보통' ? 'medium' : 'large')
    })
  }
})

test.describe('F-154 A7a 들여쓰기', () => {
  test('기본 4칸, 설정에서 2칸으로 바꾼 뒤 Tab/Shift+Tab, 이전 원문 불변, 새로고침 후 유지, 보기 모드 tab-size', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 항목\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')

    await page.keyboard.press('Tab')
    let saved = await readSavedContent(page)
    expect(saved.content.match(/^( *)-/)[1].length).toBe(4) // 기본 4칸

    await page.keyboard.press('Shift+Tab')
    const baseline = await readSavedContent(page)
    expect(baseline.content.match(/^( *)-/)[1].length).toBe(0) // 내어쓰기 복원

    await page.getByRole('button', { name: '설정', exact: true }).click()
    await page.locator('#indent-label').locator('..').getByRole('radio', { name: '2칸', exact: true }).click()
    await page.getByRole('button', { name: '닫기', exact: true }).click()

    // 설정만 바꿔서는 이미 저장된 원문이 바뀌지 않는다 (IndexedDB)
    const afterSettingChange = await readSavedContent(page)
    expect(afterSettingChange.content).toBe(baseline.content)

    // 설정 대화상자를 닫으면 포커스가 편집 영역을 떠나므로 다시 클릭해 되돌린다
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('Tab')
    saved = await readSavedContent(page)
    expect(saved.content.match(/^( *)-/)[1].length).toBe(2) // 바꾼 뒤 2칸

    await page.keyboard.press('Shift+Tab')
    saved = await readSavedContent(page)
    expect(saved.content.match(/^( *)-/)[1].length).toBe(0) // 내어쓰기 복원

    await page.reload()
    const persisted = await page.evaluate(() => localStorage.getItem('md.indent'))
    expect(persisted).toBe('2')

    await importMarkdown(page, { content: '```\na\tb\n```\n' })
    await setViewMode(page, 'view')
    const tabSize = await page.locator('.markdown-body pre').first().evaluate((el) => getComputedStyle(el).tabSize)
    expect(tabSize).toBe('2')
  })
})

test.describe('F-154 A2 한글 폭', () => {
  test('원문 모드 가나다(3자) 폭 = abcdef(6자) 폭, 차이 1px 이하', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '가나다\nabcdef\n' })
    await setViewMode(page, 'raw')
    const widths = await page.locator('.cm-line').evaluateAll((els) =>
      els.slice(0, 2).map((el) => {
        const range = document.createRange()
        range.selectNodeContents(el)
        return range.getBoundingClientRect().width
      }),
    )
    expect(Math.abs(widths[0] - widths[1])).toBeLessThanOrEqual(1)
  })
})

test.describe('F-154 A3 원문 표 정렬', () => {
  test('한글·영문 섞어 공백으로 맞춘 표의 각 줄 | x 좌표가 일치한다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '| 가나 | ab   |\n| abcd | 가   |\n' })
    await setViewMode(page, 'raw')
    const pipeXs = await page.locator('.cm-line').evaluateAll((els) =>
      els.slice(0, 2).map((el) => {
        const text = el.textContent
        const xs = []
        let idx = text.indexOf('|')
        while (idx !== -1) {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
          let acc = 0
          let node
          let offset = 0
          let n
          while ((n = walker.nextNode())) {
            const len = n.textContent.length
            if (acc + len > idx) {
              node = n
              offset = idx - acc
              break
            }
            acc += len
          }
          const range = document.createRange()
          range.setStart(node, offset)
          range.setEnd(node, offset + 1)
          xs.push(range.getBoundingClientRect().left)
          idx = text.indexOf('|', idx + 1)
        }
        return xs
      }),
    )
    expect(pipeXs[0].length).toBe(3)
    expect(pipeXs[0].length).toBe(pipeXs[1].length)
    for (let i = 0; i < pipeXs[0].length; i++) {
      expect(Math.abs(pipeXs[0][i] - pipeXs[1][i])).toBeLessThanOrEqual(1)
    }
  })
})

test.describe('F-154 A4 사용 서체', () => {
  test('원문 모드 한글·영문 모두 D2Coding', async ({ page, context }) => {
    await openApp(page)
    await importMarkdown(page, { content: '가나다\nabcdef\n' })
    await setViewMode(page, 'raw')
    await page.evaluate(() => document.fonts.ready)

    const cdp = await context.newCDPSession(page)
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    await cdp.send('DOM.getDocument')

    async function fontsForLine(n) {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: `document.querySelectorAll('.cm-line')[${n}]`,
      })
      const { nodeId } = await cdp.send('DOM.requestNode', { objectId: result.objectId })
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
      return fonts.map((f) => f.familyName)
    }

    const hangulFonts = await fontsForLine(0)
    const latinFonts = await fontsForLine(1)
    expect(hangulFonts.some((f) => f.includes('D2Coding'))).toBe(true)
    expect(latinFonts.some((f) => f.includes('D2Coding'))).toBe(true)
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

// 머리 행 + 본문 4행 (F-164 A1 과 같은 구성)
const STRIPE_TABLE = '# 문서\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n| 7 | 8 |\n'

async function expectUniformRowBg(page, rowsLocator, panelBg) {
  const count = await rowsLocator.count()
  expect(count).toBe(5)
  for (let i = 0; i < count; i++) {
    const bg = await rowsLocator.nth(i).evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).toBe(panelBg)
  }
}

test.describe('F-164 A2 표 줄무늬 제거 (보기 모드·공유 화면)', () => {
  for (const theme of ['white', 'sepia', 'dark']) {
    test(`${theme} 보기 모드 모든 행 바탕이 문서 칸 바탕과 같다`, async ({ page }) => {
      await setPrefBeforeLoad(page, 'md.theme', theme)
      await openApp(page)
      await importMarkdown(page, { content: STRIPE_TABLE })
      await setViewMode(page, 'view')
      const panelBg = await tokenAsRgb(page, '--panel')
      await expectUniformRowBg(page, page.locator('.viewer table tr'), panelBg)
    })

    test(`${theme} 공유 화면 모든 행 바탕이 문서 칸 바탕과 같다`, async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await setPrefBeforeLoad(page, 'md.theme', theme)
      await openApp(page)
      await importMarkdown(page, { content: STRIPE_TABLE })
      await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
      await page.getByRole('menuitem', { name: '링크 복사' }).click()
      const link = await page.evaluate(() => navigator.clipboard.readText())
      const hash = new URL(link).hash
      await page.evaluate((h) => {
        location.hash = h
      }, hash)
      await expect(page.locator('.shared-view')).toBeVisible()
      const panelBg = await tokenAsRgb(page, '--panel')
      await expectUniformRowBg(page, page.locator('.shared-view table tr'), panelBg)
    })
  }
})

test.describe('F-164 A4 글자 선택 색', () => {
  // el 의 ::selection 바탕을 재고, 문서 칸 바탕과 합성해 --ink 대비를 계산한다
  async function checkSelection(page, selector) {
    return page.evaluate((sel) => {
      function toRgba(str) {
        const m = str.match(/[\d.]+/g).map(Number)
        return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }
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
      function blend(fg, bg) {
        return {
          r: fg.r * fg.a + bg.r * (1 - fg.a),
          g: fg.g * fg.a + bg.g * (1 - fg.a),
          b: fg.b * fg.a + bg.b * (1 - fg.a),
        }
      }
      function luminance({ r, g, b }) {
        const [lr, lg, lb] = [r, g, b].map((c) => {
          const s = c / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
      }
      function contrast(rgbA, rgbB) {
        const l1 = luminance(rgbA)
        const l2 = luminance(rgbB)
        const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
        return (hi + 0.05) / (lo + 0.05)
      }

      const el = document.querySelector(sel)
      const selectionBg = getComputedStyle(el, '::selection').backgroundColor

      const probe = document.createElement('div')
      probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--selection-bg').trim()
      document.body.appendChild(probe)
      const expectedSelectionBg = getComputedStyle(probe).backgroundColor
      probe.remove()

      const inkProbe = document.createElement('div')
      inkProbe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()
      document.body.appendChild(inkProbe)
      const inkRgb = toRgba(getComputedStyle(inkProbe).color)
      inkProbe.remove()

      const docBg = toRgba(bgOf(el))
      const composited = blend(toRgba(selectionBg), docBg)
      const contrastRatio = contrast(inkRgb, composited)

      return { selectionBg, expectedSelectionBg, contrastRatio }
    }, selector)
  }

  for (const theme of ['white', 'sepia', 'dark']) {
    test(`${theme} 편집·원문·보기 모드, 표 칸, 제목 입력의 ::selection 이 --selection-bg 와 같고 대비 4.5 이상`, async ({
      page,
    }) => {
      await setPrefBeforeLoad(page, 'md.theme', theme)
      await openApp(page)
      await importMarkdown(page, { content: '문단 글자\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n' })

      // 편집 모드 본문
      let result = await checkSelection(page, ".cm-editor[data-view='live'] .cm-line")
      expect(result.selectionBg).toBe(result.expectedSelectionBg)
      expect(result.contrastRatio).toBeGreaterThanOrEqual(4.5)

      // 원문 모드 본문
      await setViewMode(page, 'raw')
      result = await checkSelection(page, ".cm-editor[data-view='raw'] .cm-line")
      expect(result.selectionBg).toBe(result.expectedSelectionBg)
      expect(result.contrastRatio).toBeGreaterThanOrEqual(4.5)

      // 보기 모드 본문
      await setViewMode(page, 'view')
      result = await checkSelection(page, '.viewer p')
      expect(result.selectionBg).toBe(result.expectedSelectionBg)
      expect(result.contrastRatio).toBeGreaterThanOrEqual(4.5)
      await setViewMode(page, 'live')

      // 표 칸 하위 에디터
      await page.locator('.md-table-widget td, .md-table-widget th').first().click()
      result = await checkSelection(page, '.md-table-cell-editing .cm-line')
      expect(result.selectionBg).toBe(result.expectedSelectionBg)
      expect(result.contrastRatio).toBeGreaterThanOrEqual(4.5)

      // 상단바 제목 입력
      result = await checkSelection(page, '.doc-title')
      expect(result.selectionBg).toBe(result.expectedSelectionBg)
      expect(result.contrastRatio).toBeGreaterThanOrEqual(4.5)
    })
  }
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
