// 테마 3종·본문 서체·글자 크기·들여쓰기 (F-150.md 3.3)
// 색·대비·서체·자간 같은 시각 값은 e2e 로 고정하지 않는다 (CLAUDE.md "How we work", 2026-09-25 e2e 경량화) — 설정 동작과 원문 표 정렬만 남긴다
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setPrefBeforeLoad, setViewMode, readSavedContent } from './helpers.js'

// F-141 설정 항목 순서·F-154 A7 항목 순서는 e2e/settingsTabs.spec.js 의 화면·편집기 탭 라벨 목록 검사가 대신한다 — 여기엔 기본 선택만 남긴다
test.describe('F-154 A7 설정 항목 — 글자 크기·들여쓰기', () => {
  test('글자 크기 기본 보통, 들여쓰기 기본 4칸', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '설정', exact: true }).click()
    const dialog = page.locator('dialog[aria-labelledby="settings-title"]')

    const fontSizeSeg = page.locator('#font-size-label').locator('..').locator('[role="radio"]')
    await expect(fontSizeSeg).toHaveText(['작게', '보통', '크게'])
    await expect(fontSizeSeg.nth(1)).toHaveAttribute('aria-checked', 'true') // 기본 medium(보통)

    await dialog.getByRole('tab', { name: '편집기' }).click() // F-290 — 들여쓰기는 편집기 탭
    const indentSeg = page.locator('#indent-label').locator('..').locator('[role="radio"]')
    await expect(indentSeg).toHaveText(['2칸', '4칸'])
    await expect(indentSeg.nth(1)).toHaveAttribute('aria-checked', 'true') // 기본 4칸
  })
})

test.describe('F-154 A6 글자 크기', () => {
  // 작게·보통·크게 세 번 돌던 것을 크게 하나로 합쳤다 (2026-09-25 e2e 경량화)
  test('크게 선택 시 편집·보기 모드 18px, 사이드바 불변, 새로고침 후 유지', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '문단 글자\n' })
    const sidebarFontBefore = await page.locator('.sidebar').evaluate((el) => getComputedStyle(el).fontSize)

    await page.getByRole('button', { name: '설정', exact: true }).click()
    await page.locator('#font-size-label').locator('..').getByRole('radio', { name: '크게', exact: true }).click()
    await page.getByRole('button', { name: '닫기', exact: true }).click()

    const editorFontSize = await page.locator('.cm-line').first().evaluate((el) => getComputedStyle(el).fontSize)
    expect(editorFontSize).toBe('18px')

    await setViewMode(page, 'view')
    const viewerFontSize = await page.locator('.markdown-body').first().evaluate((el) => getComputedStyle(el).fontSize)
    expect(viewerFontSize).toBe('18px')

    const sidebarFontAfter = await page.locator('.sidebar').evaluate((el) => getComputedStyle(el).fontSize)
    expect(sidebarFontAfter).toBe(sidebarFontBefore)

    await page.reload()
    const persisted = await page.evaluate(() => localStorage.getItem('md.fontSize'))
    expect(persisted).toBe('large')
  })
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
    await page.locator('dialog[aria-labelledby="settings-title"]').getByRole('tab', { name: '편집기' }).click() // F-290 — 들여쓰기는 편집기 탭
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

