// 문서 바깥 클릭 시 포커스 해제와 비포커스 표시 (specs/features/F-146.md)
import { test, expect } from '@playwright/test'
import {
  openApp,
  importMarkdown,
  readSavedContent,
  rectOf,
  fakeImeCompose,
  fakeImeCommit,
} from './helpers.js'
import { mixedDoc } from './fixtures/docs.js'

// .cm-scroller 안, .cm-content·.cm-gutters 밖(좌우 여백) 좌표
async function marginPoint(page, side) {
  const rect = await rectOf(page.locator('.cm-scroller'))
  const x = side === 'left' ? rect.left + 10 : rect.right - 10
  const y = rect.top + rect.height / 2
  return { x, y }
}

async function clickMargin(page, side) {
  const p = await marginPoint(page, side)
  await page.mouse.click(p.x, p.y)
}

// view.hasFocus 대리 지표(cm-focused 클래스는 CM6 가 view.hasFocus 그대로 반영) + activeElement 위치
async function focusState(page) {
  return page.evaluate(() => ({
    cmFocused: document.querySelector('.cm-editor').classList.contains('cm-focused'),
    activeInsideEditor: !!document.querySelector('.cm-editor')?.contains(document.activeElement),
  }))
}

test.describe('F-146 A2 여백 클릭', () => {
  test('왼쪽 여백 — 포커스 해제, activeElement 는 에디터 밖, 커서 위치는 그대로', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: mixedDoc() })

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home') // 커서를 문서 맨 앞(0)으로 고정

    await clickMargin(page, 'left')

    const state = await focusState(page)
    expect(state.cmFocused).toBe(false)
    expect(state.activeInsideEditor).toBe(false)

    // 클릭이 커서를 옮기지 않았는지 — 되돌아와 바로 입력하면 문서 맨 앞에 들어간다
    await page.locator('.cm-content').focus()
    await page.keyboard.type('X')
    const doc = await readSavedContent(page, docId)
    expect(doc.content.startsWith('X')).toBe(true)
  })

  test('오른쪽 여백도 포커스를 없앤다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: mixedDoc() })
    await page.locator('.cm-content').click()

    await clickMargin(page, 'right')

    const state = await focusState(page)
    expect(state.cmFocused).toBe(false)
    expect(state.activeInsideEditor).toBe(false)
  })

  test('여백 클릭은 드래그 선택을 시작하지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: mixedDoc() })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')

    const p = await marginPoint(page, 'left')
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x, p.y + 200)
    await page.mouse.up()

    const selectionEmpty = await page.evaluate(() => window.getSelection()?.toString() === '')
    expect(selectionEmpty).toBe(true)
  })
})

test.describe('F-146 A3 비포커스 표시', () => {
  const DOC = '# 제목\n\n**굵게**\n\n[링크](https://a.com)\n'

  test('제목·굵게·링크 줄에 커서를 둔 뒤 여백을 클릭하면 기호가 숨겨지고 커서가 사라진다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: DOC })

    const headingLine = page.locator('.cm-line.md-h1')
    const boldLine = page.locator('.cm-content .cm-line', { hasText: '굵게' })
    const linkLine = page.locator('.cm-content .cm-line', { hasText: '링크' })

    // 각 줄에 커서를 두면 기호가 드러난다(F-104·F-129 기존 동작)
    await headingLine.click()
    await expect(headingLine).toContainText('# 제목')
    await boldLine.click()
    await expect(boldLine.locator('.md-mark')).not.toHaveCount(0)
    await linkLine.click()
    await expect(linkLine).toContainText('(https://a.com)')

    await clickMargin(page, 'left')

    const state = await focusState(page)
    expect(state.cmFocused).toBe(false)

    // 세 줄 모두 기호가 숨겨진 프리뷰로 돌아간다 — 보이는 .md-mark 기호 요소 0개
    await expect(page.locator('.md-mark')).toHaveCount(0)
    await expect(headingLine).toHaveText('제목')
    await expect(boldLine).toHaveText('굵게')
    await expect(linkLine).toHaveText('링크')
  })
})

test.describe('F-146 A4 복귀', () => {
  test('문서 칸 글자를 클릭하면 그 자리에 커서·줄이 드러난다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '# 제목\n\n문단\n' })

    const headingLine = page.locator('.cm-line.md-h1')
    await headingLine.click()
    await clickMargin(page, 'left')
    await expect(headingLine).toHaveText('제목')

    await headingLine.click()
    const state = await focusState(page)
    expect(state.cmFocused).toBe(true)
    await expect(headingLine).toContainText('# 제목')
  })

  test('사이드바(설정 대화상자) 로 포커스가 간 뒤 편집기로 돌아오면 이전 선택 위치가 이어진다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '문단 하나\n둘째 줄\n' })

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('ArrowDown') // 둘째 줄 시작
    await page.keyboard.press('End') // 둘째 줄 끝

    // 사이드바 버튼(설정) 클릭 — 대화상자가 뜨며 포커스가 편집기 밖으로 간다
    await page.getByRole('button', { name: '설정', exact: true }).first().click()
    await expect(page.locator('dialog.dialog[open]')).toBeVisible()
    let state = await focusState(page)
    expect(state.cmFocused).toBe(false)

    await page.keyboard.press('Escape')
    await expect(page.locator('dialog.dialog[open]')).toHaveCount(0)

    // 편집기로 복귀(키보드 경로 — Tab 이 실제로 거치는 노드는 UI 레이아웃에 따라 달라지므로, 포커스가 편집기 contentDOM 으로 돌아오는 것 자체를 focus() 로 흉내낸다)
    await page.locator('.cm-content').focus()
    state = await focusState(page)
    expect(state.cmFocused).toBe(true)

    await page.keyboard.type('X')
    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('둘째 줄X')
  })
})

test.describe('F-146 A5 문서 칸 안 빈 곳', () => {
  test('줄 끝 오른쪽·위 여백·아래 여백을 눌러도 CM6 기본대로 커서가 놓이고 포커스가 유지된다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '짧은 줄\n\n문단\n' })

    const contentRect = await rectOf(page.locator('.cm-content'))

    // 줄 끝 오른쪽 빈 곳
    const shortLineRect = await rectOf(page.locator('.cm-line', { hasText: '짧은 줄' })) // F-217 제목 블록 아래 실제 첫 줄
    await page.mouse.click(contentRect.right - 5, shortLineRect.top + shortLineRect.height / 2)
    let state = await focusState(page)
    expect(state.cmFocused).toBe(true)

    // 위 여백(문서 첫 줄 위, F-143 3.10 의 48px 패딩 안)
    await page.mouse.click(contentRect.left + contentRect.width / 2, contentRect.top + 5)
    state = await focusState(page)
    // F-217 이후 첫 줄 위는 본문 제목 — 제목 입력칸에 포커스가 가도 에디터 안이다
    const titleFocused = await page.evaluate(() => document.activeElement?.classList.contains('doc-title') ?? false)
    expect(state.cmFocused || titleFocused).toBe(true)

    // 아래 여백(F-143 3.10 의 50dvh 패딩 안)
    await page.mouse.click(contentRect.left + contentRect.width / 2, contentRect.bottom - 5)
    state = await focusState(page)
    expect(state.cmFocused).toBe(true)
  })
})

test.describe('F-146 A6 표·자동완성', () => {
  test('표 칸 편집 중 포커스 전환 신호가 와도 위젯이 유지되고 칸 편집이 계속된다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, {
      content: '문단\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n',
    })

    await page.locator('.cm-content').click() // 주 에디터에 먼저 포커스(focusin 1회 발생)
    const cell = page.locator('.md-table-widget td').first() // 데이터 행 첫 칸("1")
    await cell.click() // 표 칸으로 포커스 이동 — 주 view.dom 안이라 편집기 포커스는 유지된다
    await expect(page.locator('.md-table-cell-editing')).toHaveCount(1)
    await page.keyboard.press('End')

    await page.keyboard.type('X')
    // 입력 중에도 위젯 DOM 이 파괴되지 않고 칸 편집이 계속된다
    await expect(page.locator('.md-table-cell-editing')).toHaveCount(1)
    await expect(page.locator('.md-table-widget')).toHaveCount(1)

    await page.keyboard.press('Escape')
    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('| 1X | 2 |')
  })

  test('[[ 자동완성 목록이 뜬 동안에도 편집기 포커스가 유지되고 방향키·Enter 로 선택된다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '# 나의 문서\n\n본문\n' })

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n[[')

    const list = page.locator('.cm-tooltip-autocomplete ul')
    await expect(list).toBeVisible()

    // 자동완성은 DOM 포커스를 옮기지 않는다 — 여전히 편집기 포커스로 본다
    const state = await focusState(page)
    expect(state.cmFocused).toBe(true)

    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(list).toBeHidden()
    await expect(page.locator('.cm-content')).toContainText('나의 문서')
  })
})

test.describe('F-146 A7 조합 중 여백 클릭', () => {
  test('조합 중 여백을 클릭하면 글자가 한 번만 확정되고 콘솔 예외 없이 비포커스 표시가 된다', async ({ page }) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n' })

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')

    const cdp = await fakeImeCompose(page, '한글')
    await fakeImeCommit(cdp, '한글')

    await clickMargin(page, 'left')
    await page.waitForTimeout(200) // compositionCatchup 의 setTimeout(0) 이 따라잡을 시간

    const state = await focusState(page)
    expect(state.cmFocused).toBe(false)
    expect(errors).toEqual([])

    const doc = await readSavedContent(page, docId)
    const occurrences = doc.content.split('한글').length - 1
    expect(occurrences).toBe(1)
  })
})

test.describe('F-146 A8 회귀', () => {
  // F-124 A2d(거터 숫자가 옮겨진 제목 줄 클릭 위치)는 e2e/editor.spec.js F-152 A2 의 같은 test 가 본다

  test('F-129 — 기호 숨김 링크 클릭은 여전히 새 탭을 가로챈다(내비게이션 없음)', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '문단 [링크](https://example.com) 끝\n' })

    // window.open 으로 새 탭은 뜨되, 같은 페이지 내비게이션은 없다.
    // 고정 대기(200ms)로 보면 popup 이 그 안에 안 와서 늘 실패한다 — 실제로는 1초 안팎 (2026-09-21)
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByText('링크', { exact: true }).click(),
    ])
    expect(popup).toBeTruthy()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  })

  test('원문 모드 여백 클릭 — 포커스만 없앤다(모양은 그대로)', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '# 제목\n\n문단\n' })
    await page.getByRole('button', { name: '원문 — 마크다운 기호 그대로 편집', exact: true }).click()

    await page.locator('.cm-content').click()
    const before = await page.locator('.cm-content').innerText()

    await clickMargin(page, 'left')
    const state = await focusState(page)
    expect(state.cmFocused).toBe(false)

    const after = await page.locator('.cm-content').innerText()
    expect(after).toBe(before) // 원문은 애초에 마크 숨김이 없다 — 모양 변화 없음
  })
})

// F-146 A11 자동완성 목록 여백(ul 6px, li 7·9px)은 시각 값이라 e2e 에서 뺐다 — specs/human-checks.md (2026-09-25 e2e 경량화)
