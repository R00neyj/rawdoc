// 로컬 Y.Doc 되돌리기 — 지금 history() 와 같은 묶음·기록 수명 (specs/features/F-302.md 11.2)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, setViewMode, fakeImeCompose, fakeImeCommit } from './helpers.js'

// 저장 디바운스 뒤 IndexedDB 원문이 기대값이 될 때까지 기다린다
async function expectSaved(page, expected, docId) {
  await expect.poll(async () => (await readSavedContent(page, docId))?.content, { timeout: 10_000 }).toBe(expected)
}

async function clickLineEnd(page, text) {
  await page.locator('.cm-content .cm-line', { hasText: text }).first().click()
  await page.keyboard.press('End')
}

// image.spec.js pasteFiles 방식 — 파일 없이 text/plain 만
async function pasteText(page, text) {
  await page.evaluate((text) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', text)
    document
      .querySelector('.cm-content')
      .dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
  }, text)
}

async function typeThenPaste(page) {
  await importMarkdown(page, { name: '되돌리기.md', content: '본문\n' })
  await clickLineEnd(page, '본문')
  await page.keyboard.type('abc')
  await pasteText(page, 'PP')
  await expect(page.locator('.cm-content')).toContainText('본문abcPP')
}

test.describe('F-302 A8', () => {
  test('F-302 A8 입력 직후 붙여넣기 — Ctrl+Z 1회에 붙여넣기만', async ({ page }) => {
    await openApp(page)
    await typeThenPaste(page)
    await page.keyboard.press('Control+z')
    await expectSaved(page, '본문abc\n')
  })
})

test.describe('F-302 A9', () => {
  test('F-302 A9 입력 → 커서 이동 → 입력 — Ctrl+Z 1회에 뒤 입력만', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '되돌리기.md', content: '본문\n' })
    await clickLineEnd(page, '본문')
    await page.keyboard.type('abc')
    await page.keyboard.press('Home')
    await page.keyboard.type('X')
    await page.keyboard.press('Control+z')
    await expectSaved(page, '본문abc\n')
  })
})

test.describe('F-302 A10', () => {
  test('F-302 A10 다시 실행 — Ctrl+Y 와 Ctrl+Shift+Z', async ({ page }) => {
    await openApp(page)
    await typeThenPaste(page)
    await page.keyboard.press('Control+z')
    await expectSaved(page, '본문abc\n')
    await page.keyboard.press('Control+y')
    await expectSaved(page, '본문abcPP\n')
    await page.keyboard.press('Control+z')
    await expectSaved(page, '본문abc\n')
    // 'Control+Shift+z' 는 key 가 소문자 'z' 로 가 CM6 가 Ctrl-z 로 읽는다. 실제 키보드처럼 key 'Z' 를 보내려면 KeyZ
    await page.keyboard.press('Control+Shift+KeyZ')
    await expectSaved(page, '본문abcPP\n')
  })
})

test.describe('F-302 A11', () => {
  test('F-302 A11 문서를 바꾸면 실행 취소 기록이 사라진다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '되돌리기나.md', content: '둘째\n' })
    const docA = await importMarkdown(page, { name: '되돌리기가.md', content: '본문\n' })
    await clickLineEnd(page, '본문')
    await page.keyboard.type('abc')
    await expectSaved(page, '본문abc\n', docA)

    await page.locator('.doc-item-btn', { hasText: '되돌리기나' }).click()
    await expect(page.locator('.cm-content')).toContainText('둘째')
    await page.locator('.doc-item-btn', { hasText: '되돌리기가' }).click()
    await expect(page.locator('.cm-content')).toContainText('본문abc')

    await clickLineEnd(page, '본문abc')
    await page.keyboard.press('Control+z')
    // 되돌리기가 아무것도 안 했는지를 뒤이은 입력 결과로 판정한다 — abc 가 지워졌다면 '본문Q' 가 된다
    await page.keyboard.type('Q')
    await expectSaved(page, '본문abcQ\n', docA)
  })
})

test.describe('F-302 A12', () => {
  test('F-302 A12 보기 모드를 다녀와도 실행 취소 기록 유지', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '되돌리기.md', content: '본문\n' })
    await clickLineEnd(page, '본문')
    await page.keyboard.type('abc')
    await expectSaved(page, '본문abc\n')

    await setViewMode(page, 'view')
    await setViewMode(page, 'live')
    await clickLineEnd(page, '본문abc')
    await page.keyboard.press('Control+z')
    await expectSaved(page, '본문\n')
  })
})

test.describe('F-302 A13', () => {
  test('F-302 A13 CRLF 문서 — 입력한 바이트만 바뀐다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '크렐프.md', content: 'a\r\nb\r\n' })
    await clickLineEnd(page, 'a')
    await page.keyboard.type('X')
    await expectSaved(page, 'aX\r\nb\r\n')
    await page.keyboard.press('Control+z')
    await expectSaved(page, 'a\r\nb\r\n')
  })
})

test.describe('F-302 A14', () => {
  test('F-302 A14 조합 흉내 3단계 — Ctrl+Z 결과가 지금과 같다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '조합.md', content: '본문\n' })
    await clickLineEnd(page, '본문')
    await page.keyboard.press('Control+End')

    const cdp = await fakeImeCompose(page, 'ㅎ')
    await page.waitForTimeout(700)
    await cdp.send('Input.imeSetComposition', { text: '하', selectionStart: 1, selectionEnd: 1 })
    await page.waitForTimeout(700)
    await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 })
    await fakeImeCommit(cdp, '한')
    await expectSaved(page, '본문\n한')

    await page.keyboard.press('Control+z')
    await expectSaved(page, '본문\n')
  })
})

test.describe('F-302 A15', () => {
  test('F-302 A15 Yjs 가 한 벌만 불린다', async ({ page }) => {
    const errors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    await openApp(page)
    await typeThenPaste(page)
    await page.keyboard.press('Control+z')
    await expectSaved(page, '본문abc\n')
    expect(errors.filter((text) => text.includes('Yjs was already imported'))).toEqual([])
  })
})
