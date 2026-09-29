// 한글 입력 중 목록 줄 엔터가 두 번 넘어가는 문제 (specs/features/F-245.md) — CDP 조합은 시각 표시(cm-composing)는 실제 IME 와 다르지만 view.composing 은 true 가 되어 CM6 가 keydown 을 건너뛰는 조건은 같다(F-245.md 3.3)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, fakeImeCompose, openExportMenu } from './helpers.js'

async function placeCursorAtEnd(page) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
}

async function exportMdText(page) {
  await openExportMenu(page)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: '.md', exact: true }).click(),
  ])
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf-8')
}

// 줄바꿈 없는 원문은 저장 시 CRLF 로 기본 판정된다(F-110 3.3, F-245 와 무관) — 앞에 빈 줄을 둬 LF 로 판정시킨다
// 조합 없는 Enter(F-245 A6·A11~A16·A19, F-253 B2~B10)는 src/editor/listEnter.test.ts runEnter 가 같은 입력·기대값으로 본다 (2026-09-25 e2e 경량화)
test.describe('F-245 조합 경로', () => {
  test('F-245 A1·A2·A3·A4·A5·A7 조합 중 Enter — 글머리·순서 목록·체크박스·중첩·빈 항목 끝내기, .md 내보내기 원문 불변', async ({ page }) => {
    await openApp(page)
    const cases = [
      { content: '\n- ', typed: '테스트', expected: '\n- 테스트\n- X' },
      { content: '\n1. ', typed: '테스트', expected: '\n1. 테스트\n2. X' },
      { content: '\n- [ ] ', typed: '테스트', expected: '\n- [ ] 테스트\n- [ ] X' },
      { content: '- 상위\n  - ', typed: '테스트', expected: '- 상위\n  - 테스트\n  - X' },
    ]
    for (const { content, typed, expected } of cases) {
      const docId = await importMarkdown(page, { content })
      await placeCursorAtEnd(page)
      await fakeImeCompose(page, typed)
      await page.keyboard.press('Enter')
      await page.keyboard.type('X')
      expect((await readSavedContent(page, docId)).content).toBe(expected)
    }

    // 항목 2개짜리 tight list 는 빈 마지막 항목 엔터가 list 를 non-tight 로 바꿀 뿐 안 끝낸다(CM6 규칙, F-245 무관) — 항목 3개로 피한다
    const endId = await importMarkdown(page, { content: '- 항목\n- 둘째\n- ' })
    await placeCursorAtEnd(page)
    await fakeImeCompose(page, '')
    await page.keyboard.press('Enter')
    expect((await readSavedContent(page, endId)).content).toBe('- 항목\n- 둘째\n')

    await importMarkdown(page, { content: '\n- ' })
    await placeCursorAtEnd(page)
    await fakeImeCompose(page, '테스트')
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')
    const text = await exportMdText(page)
    expect(text).toBe('\n- 테스트\n- X')
    expect(text.split('\n')).toHaveLength(3)
  })
})
