// 한글 입력 중 목록 줄 엔터가 두 번 넘어가는 문제 (specs/features/F-245.md) — CDP 조합은 시각 표시(cm-composing)는 실제 IME 와 다르지만 view.composing 은 true 가 되어 CM6 가 keydown 을 건너뛰는 조건은 같다(F-245.md 3.3)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, fakeImeCompose } from './helpers.js'

async function placeCursorAtEnd(page) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
}

// 줄바꿈 없는 원문은 저장 시 CRLF 로 기본 판정된다(F-110 3.3, F-245 와 무관) — 앞에 빈 줄을 둬 LF 로 판정시킨다
test.describe('F-245 A1 조합 경로 — 글머리', () => {
  test('- 테스트 → Enter → - X, 빈 줄 없음', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n- ' })
    await placeCursorAtEnd(page)

    await fakeImeCompose(page, '테스트')
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')

    const saved = await readSavedContent(page, docId)
    expect(saved.content).toBe('\n- 테스트\n- X')
  })
})

test.describe('F-245 A2 조합 경로 — 순서 목록', () => {
  test('1. 테스트 → Enter → 2. X', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n1. ' })
    await placeCursorAtEnd(page)

    await fakeImeCompose(page, '테스트')
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')

    const saved = await readSavedContent(page, docId)
    expect(saved.content).toBe('\n1. 테스트\n2. X')
  })
})

test.describe('F-245 A3 조합 경로 — 체크박스', () => {
  test('- [ ] 테스트 → Enter → - [ ] X', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n- [ ] ' })
    await placeCursorAtEnd(page)

    await fakeImeCompose(page, '테스트')
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')

    const saved = await readSavedContent(page, docId)
    expect(saved.content).toBe('\n- [ ] 테스트\n- [ ] X')
  })
})

test.describe('F-245 A4 조합 경로 — 중첩', () => {
  test('2단계 들여쓰기를 유지한 채 다음 줄도 같은 들여쓰기', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '- 상위\n  - ' })
    await placeCursorAtEnd(page)

    await fakeImeCompose(page, '테스트')
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')

    const saved = await readSavedContent(page, docId)
    expect(saved.content).toBe('- 상위\n  - 테스트\n  - X')
  })
})

test.describe('F-245 A5 조합 경로 — 빈 항목에서 끝내기', () => {
  // 항목 2개짜리 tight list 는 빈 마지막 항목 엔터가 list 를 non-tight 로 바꿀 뿐 안 끝낸다(CM6 규칙, F-245 무관) — 항목 3개로 피한다
  test('빈 목록 줄에서 조합 중 Enter → 기호를 지우고 목록을 끝낸다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '- 항목\n- 둘째\n- ' })
    await placeCursorAtEnd(page)

    // 빈 항목 조합 — 실제 문자는 없지만 view.composing 은 true 로 남는다
    await fakeImeCompose(page, '')
    await page.keyboard.press('Enter')

    const saved = await readSavedContent(page, docId)
    expect(saved.content).toBe('- 항목\n- 둘째\n')
  })
})

test.describe('F-245 A6 비조합 회귀', () => {
  test('합성 키 입력만으로 A1~A5 가 지금처럼 정상 동작한다', async ({ page }) => {
    await openApp(page)

    const docId1 = await importMarkdown(page, { content: '\n- ' })
    await placeCursorAtEnd(page)
    await page.keyboard.type('테스트')
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')
    expect((await readSavedContent(page, docId1)).content).toBe('\n- 테스트\n- X')

    const docId2 = await importMarkdown(page, { content: '\n1. ' })
    await placeCursorAtEnd(page)
    await page.keyboard.type('테스트')
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')
    expect((await readSavedContent(page, docId2)).content).toBe('\n1. 테스트\n2. X')

    const docId3 = await importMarkdown(page, { content: '\n- [ ] ' })
    await placeCursorAtEnd(page)
    await page.keyboard.type('테스트')
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')
    expect((await readSavedContent(page, docId3)).content).toBe('\n- [ ] 테스트\n- [ ] X')

    const docId4 = await importMarkdown(page, { content: '- 상위\n  - ' })
    await placeCursorAtEnd(page)
    await page.keyboard.type('테스트')
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')
    expect((await readSavedContent(page, docId4)).content).toBe('- 상위\n  - 테스트\n  - X')

    const docId5 = await importMarkdown(page, { content: '- 항목\n- 둘째\n- ' })
    await placeCursorAtEnd(page)
    await page.keyboard.press('Enter')
    expect((await readSavedContent(page, docId5)).content).toBe('- 항목\n- 둘째\n')
  })
})

test.describe('F-245 A7 원문 불변', () => {
  test('.md 내보내기 결과가 화면에서 본 줄 수와 같다 — 빈 줄이 몰래 들어가지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '\n- ' })
    await placeCursorAtEnd(page)

    await fakeImeCompose(page, '테스트')
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '.md 파일로 내보내기' }).click(),
    ])
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf-8')
    expect(text).toBe('\n- 테스트\n- X')
    expect(text.split('\n')).toHaveLength(3)
  })
})
