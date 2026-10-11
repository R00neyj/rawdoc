// 서식 바 '이미지' 버튼·터치 기기 들여쓰기(Tab) 버튼 (small change, specs/small-changes.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, fakeSoftKeyboard, waitSaved, readSavedContent, setPrefBeforeLoad } from './helpers.js'

// IHDR 만 있는 최소 PNG — 크기 판정만 하면 저장된다 (image.spec.js 와 같은 방식)
function pngBuffer(width, height) {
  const head = Buffer.alloc(16)
  head.writeUInt32BE(13, 0)
  head.write('IHDR', 4, 'ascii')
  head.writeUInt32BE(width, 8)
  head.writeUInt32BE(height, 12)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), head, Buffer.from([8, 6, 0, 0, 0])])
}

test.describe('small 휴대폰 서식 바 (390×844, 터치)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  // 저장 공간 알림 카드가 본문 윗줄을 덮는다 (toolbarDock.spec.js E1 과 같은 이유)
  test.beforeEach(({ page }) => setPrefBeforeLoad(page, 'md.persistNoticeShown', '1'))

  test('small 툴바 이미지 — 삽입 탭 이미지 버튼으로 고른 파일이 선택 위치에 들어가고 같은 파일을 다시 고를 수 있다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '첫째\n\n둘째\n' })
    await page.locator('.cm-content .cm-line', { hasText: '첫째' }).tap()
    await fakeSoftKeyboard(page, true)
    await page.keyboard.press('End')
    const row = page.locator('.editor-toolbar-row--docked')
    await row.getByRole('button', { name: /^서식 분류/ }).tap()
    await page.getByRole('menuitemradio', { name: '삽입' }).tap()

    const file = { name: '사진.png', mimeType: 'image/png', buffer: pngBuffer(40, 20) }
    for (let i = 1; i <= 2; i++) {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), row.getByRole('button', { name: '이미지', exact: true }).tap()])
      await chooser.setFiles(file)
      await expect.poll(async () => ((await readSavedContent(page)).content.match(/!\[사진\|center\|\d+\]\(attachments\/[0-9a-f]{16}\.png\)/g) ?? []).length).toBe(i)
    }
    await waitSaved(page)
    const { content } = await readSavedContent(page)
    expect(content.indexOf('첫째')).toBeLessThan(content.indexOf('attachments/'))
    expect(content.indexOf('attachments/')).toBeLessThan(content.indexOf('둘째'))
    await expect.poll(() => page.evaluate(() => document.activeElement === document.querySelector('.cm-host .cm-content'))).toBe(true)
  })

  test('small 툴바 들여쓰기 — Tab 버튼이 목록 줄을 들여쓴다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 하나\n- 둘\n' })
    await page.locator('.cm-content .cm-line', { hasText: '둘' }).tap()
    await fakeSoftKeyboard(page, true)
    await page.locator('.editor-toolbar-row--docked').getByRole('button', { name: '들여쓰기 (Tab)' }).tap()
    await waitSaved(page)
    expect((await readSavedContent(page)).content).toMatch(/^- 하나\n[ \t]+- 둘\n$/)
  })
})
