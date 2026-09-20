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

// 6장 재조사 — 진짜 원인은 IME 가 아니라 항목 2개짜리 목록의 빈 항목 Enter (specs/features/F-245.md 6.2)
test.describe('F-245 A11 항목 2개 — 빈 항목 Enter', () => {
  test('- 하나 + - 끝에서 Enter → 빈 줄도 기호도 없이 목록이 끝난다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n- 하나\n- ' })
    await placeCursorAtEnd(page)

    await page.keyboard.press('Enter')
    await page.keyboard.type('X')

    const saved = await readSavedContent(page, docId)
    expect(saved.content).toBe('\n- 하나\nX')
  })
})

test.describe('F-245 A12 항목 2개 — 체크박스', () => {
  test('- [x] test + - [ ] 끝에서 Enter → 목록이 끝난다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n- [x] test\n- [ ] ' })
    await placeCursorAtEnd(page)

    await page.keyboard.press('Enter')
    await page.keyboard.type('X')

    const saved = await readSavedContent(page, docId)
    expect(saved.content).toBe('\n- [x] test\nX')
  })
})

test.describe('F-245 A14 항목 1개·3개 — 회귀', () => {
  test('항목 1개', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n- ' })
    await placeCursorAtEnd(page)
    await page.keyboard.press('Enter')
    expect((await readSavedContent(page, docId)).content).toBe('\n')
  })

  test('항목 3개', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n- 하나\n- 둘\n- ' })
    await placeCursorAtEnd(page)
    await page.keyboard.press('Enter')
    expect((await readSavedContent(page, docId)).content).toBe('\n- 하나\n- 둘\n')
  })
})

// F-245 6.5 A15 를 뒤집는다 — loose 목록 이어쓰기가 빈 줄을 새로 만들지 않는다 (specs/features/F-253.md)
test.describe('F-253 B2 loose 글머리', () => {
  test('- 하나\\n\\n- 둘 끝에서 Enter → 새 빈 줄 없이 바로 다음 줄, 원래 빈 줄은 그대로', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n- 하나\n\n- 둘' })
    await placeCursorAtEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')
    expect((await readSavedContent(page, docId)).content).toBe('\n- 하나\n\n- 둘\n- X')
  })
})

test.describe('F-253 B3 loose 체크박스', () => {
  test('- [x] 완료\\n\\n- 테스트 끝에서 Enter', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n- [x] 완료\n\n- 테스트' })
    await placeCursorAtEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')
    expect((await readSavedContent(page, docId)).content).toBe('\n- [x] 완료\n\n- 테스트\n- X')
  })
})

test.describe('F-253 B4 loose 순서 목록', () => {
  test('1. 하나\\n\\n2. 둘 끝에서 Enter → 번호 증가 유지', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n1. 하나\n\n2. 둘' })
    await placeCursorAtEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')
    expect((await readSavedContent(page, docId)).content).toBe('\n1. 하나\n\n2. 둘\n3. X')
  })
})

test.describe('F-253 B5 loose 중첩', () => {
  test('- 하나\\n\\n  - 둘 끝에서 Enter → 들여쓰기 유지한 채 바로 다음 줄', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n- 하나\n\n  - 둘' })
    await placeCursorAtEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')
    expect((await readSavedContent(page, docId)).content).toBe('\n- 하나\n\n  - 둘\n  - X')
  })
})

test.describe('F-253 B8 loose 목록 빈 항목 Enter', () => {
  test('- 하나\\n\\n- 끝에서 Enter → 목록이 끝난다, 앞의 빈 줄은 그대로', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n- 하나\n\n- ' })
    await placeCursorAtEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')
    expect((await readSavedContent(page, docId)).content).toBe('\n- 하나\n\nX')
  })
})

test.describe('F-253 B9 인용문 안 목록', () => {
  test('> - 하나\\n>\\n> - 둘 끝에서 Enter → 바로 다음 줄에 인용·목록 기호', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n> - 하나\n>\n> - 둘' })
    await placeCursorAtEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')
    expect((await readSavedContent(page, docId)).content).toBe('\n> - 하나\n>\n> - 둘\n> - X')
  })
})

test.describe('F-253 B10 원문 불변', () => {
  test('B2 결과를 .md 로 내보내기 — 화면에서 본 줄 수와 같다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '\n- 하나\n\n- 둘' })
    await placeCursorAtEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')

    await page.getByRole('button', { name: '내보내기 — .md·.txt 파일' }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: '.md', exact: true }).click(),
    ])
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf-8')
    expect(text).toBe('\n- 하나\n\n- 둘\n- X')
    expect(text.split('\n')).toHaveLength(5)
  })
})

test.describe('F-245 A16 순서 목록·중첩', () => {
  test('순서 목록 — 목록이 끝난다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n1. 하나\n2. ' })
    await placeCursorAtEnd(page)
    await page.keyboard.press('Enter')
    expect((await readSavedContent(page, docId)).content).toBe('\n1. 하나\n')
  })

  test('중첩 목록 — 목록이 끝난다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n  - 하나\n  - ' })
    await placeCursorAtEnd(page)
    await page.keyboard.press('Enter')
    expect((await readSavedContent(page, docId)).content).toBe('\n  - 하나\n')
  })
})

test.describe('F-245 A19 원문 불변', () => {
  test('A11 결과를 .md 로 내보내기 — 화면에서 본 줄 수와 같다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '\n- 하나\n- ' })
    await placeCursorAtEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')

    await page.getByRole('button', { name: '내보내기 — .md·.txt 파일' }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: '.md', exact: true }).click(),
    ])
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf-8')
    expect(text).toBe('\n- 하나\nX')
    expect(text.split('\n')).toHaveLength(3)
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

    await page.getByRole('button', { name: '내보내기 — .md·.txt 파일' }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: '.md', exact: true }).click(),
    ])
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf-8')
    expect(text).toBe('\n- 테스트\n- X')
    expect(text.split('\n')).toHaveLength(3)
  })
})
