// 편집 모드 프론트매터를 표로 (specs/features/F-155.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, setViewMode } from './helpers.js'

// 닫는 줄 바로 다음 줄이 본문(빈 줄 없음) — "닫는 줄 다음 줄 시작" 커서 보정 위치를 단순하게 확인하려는 목적
const DOC = '---\n과목: 웹\n차시: 3\n---\n본문 문단\n'

test.describe('F-155 A2 편집 모드 표', () => {
  test('--- 글자가 안 보이고 표 셀 글자가 보기 모드와 같다, 위젯 1개', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: DOC })

    const widget = page.locator('.md-frontmatter-widget')
    await expect(widget).toHaveCount(1)
    await expect(page.locator('.cm-content')).not.toContainText('---')

    const editCells = await widget.locator('table.markdown-frontmatter td, table.markdown-frontmatter th').allTextContents()

    await setViewMode(page, 'view')
    const viewCells = await page
      .locator('.viewer table.markdown-frontmatter td, .viewer table.markdown-frontmatter th')
      .allTextContents()
    expect(editCells).toEqual(viewCells)
    expect(editCells).toEqual(['과목', '웹', '차시', '3'])
  })
})

test.describe('F-155 A3·A4 커서 보정·원문 불변', () => {
  test('문서 열기 직후 커서가 본문 첫 줄에 있다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: DOC })

    await page.keyboard.type('X')
    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('---\nX본문 문단')
    expect(doc.content).toContain('과목: 웹\n차시: 3\n---') // 프론트매터 바이트 불변
  })

  // Ctrl+Home·위젯 클릭·위 화살표 세 경로를 test 하나로 합쳤다 — 칠 때마다 본문 첫 줄 맨 앞에 쌓인다
  test('Ctrl+Home·위젯 클릭·위젯 아래 줄에서 위 화살표 모두 본문 첫 줄 맨 앞으로 보낸다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: DOC })

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Control+Home')
    await page.keyboard.type('A')
    expect((await readSavedContent(page, docId)).content).toContain('---\nA본문 문단')

    // 위젯을 클릭해도 본문 첫 줄로 보낸다, 그 밖의 동작은 없다
    await page.locator('.md-frontmatter-widget table').click()
    await page.keyboard.type('B')
    expect((await readSavedContent(page, docId)).content).toContain('---\nBA본문 문단')

    // 위젯 아래 줄에서 위 화살표를 눌러도 그 자리에 남는다
    await page.locator('.cm-content .cm-line', { hasText: '본문 문단' }).click()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.type('C')
    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('---\nCBA본문 문단')
    expect(doc.content).toContain('과목: 웹\n차시: 3\n---') // 프론트매터 바이트 불변
  })
})

test.describe('F-155 A5 예외', () => {
  test('빈 프론트매터는 위젯이 아니라 원문 상자 그대로', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '---\n---\n본문\n' })

    await expect(page.locator('.md-frontmatter-widget')).toHaveCount(0)
    await expect(page.locator('.cm-line.md-frontmatter-first')).toHaveCount(1)
  })

  test('닫는 줄로 끝나는 문서는 위젯이 아니라 원문 상자 그대로', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '---\n과목: 웹\n---' })

    await expect(page.locator('.md-frontmatter-widget')).toHaveCount(0)
    await expect(page.locator('.cm-line.md-frontmatter-first')).toHaveCount(1)
  })

  test('해석할 수 없는 내용은 위젯 안 pre 로 원문 그대로', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '---\nparent:\n  child: 1\n---\n본문\n' })

    const widget = page.locator('.md-frontmatter-widget')
    await expect(widget).toHaveCount(1)
    await expect(widget.locator('table.markdown-frontmatter')).toHaveCount(0)
    const pre = widget.locator('pre.markdown-frontmatter-raw')
    await expect(pre).toHaveCount(1)
    await expect(pre).toContainText('parent:')
    await expect(pre).toContainText('child: 1')
  })
})

test.describe('F-155 A6 원문 모드', () => {
  test('원문 그대로 보이고 편집 가능하다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: DOC })

    await setViewMode(page, 'raw')
    await expect(page.locator('.md-frontmatter-widget')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('---')
    await expect(page.locator('.cm-content')).toContainText('과목: 웹')

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.type('X')
    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('X---\n과목')
  })
})

test.describe('F-155 A7 거터·클릭', () => {
  test('위젯 다음 줄 번호 = 닫는 줄 번호 + 1, 위젯 아래 줄 클릭 위치 일치', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: DOC })

    const numbers = await page.evaluate(() =>
      [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => Number(el.textContent)),
    )
    // 프론트매터(1~4줄)는 위젯 하나(표·코드블록과 같은 block decoration)라 그 줄 몫 숫자를 그리지 않는다(실측 확인, F-106 표·코드블록과 같은 동작). 다음 숫자는 닫는 줄(4) + 1 = 5
    expect(numbers).toEqual([5, 6])

    // 위젯 아래 줄(본문) 클릭 위치가 실제로 그 줄이다 (F-124 A2d 방법)
    await page.locator('.cm-content .cm-line', { hasText: '본문 문단' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('본문 문단!')
  })
})
