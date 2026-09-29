// 설정: 줄 번호(거터) 켜기·끄기 (specs/features/F-147.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, setViewMode } from './helpers.js'
import { longDoc } from './fixtures/docs.js'

const LINE_NUMBERS_LABEL_SCOPE = '#line-numbers-label'

async function openSettings(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
}

async function closeSettings(page) {
  await page.getByRole('button', { name: '닫기', exact: true }).click()
}

async function setLineNumbers(page, label) {
  await openSettings(page)
  await page.locator('dialog[aria-labelledby="settings-title"]').getByRole('tab', { name: '편집기' }).click() // F-290 — 줄 번호는 편집기 탭
  await page.locator(LINE_NUMBERS_LABEL_SCOPE).locator('..').getByRole('radio', { name: label, exact: true }).click()
  await closeSettings(page)
}

test.describe('F-147 A2 끄기·켜기', () => {
  for (const mode of ['live', 'raw']) {
    test(`${mode} 모드 — 거터 사라짐/생김, 커서·선택·실행 취소 유지`, async ({ page }) => {
      await openApp(page)
      const docId = await importMarkdown(page, { content: '내용\n' })
      if (mode === 'raw') await setViewMode(page, 'raw')

      await expect(page.locator('.cm-gutters')).toHaveCount(1)

      await page.locator('.cm-content').click()
      await page.keyboard.press('Control+Home')
      await page.keyboard.type('EDIT1')
      await page.keyboard.press('Shift+ArrowLeft')
      await page.keyboard.press('Shift+ArrowLeft') // "T1" 선택 상태

      await setLineNumbers(page, '숨김')
      await expect(page.locator('.cm-gutters')).toHaveCount(0)

      // 선택 유지 확인 — 선택된 "T1" 이 새 입력으로 바뀐다(포커스만 DOM 상 되돌린다, 위치는 건드리지 않는다)
      await page.locator('.cm-content').focus()
      await page.keyboard.type('XY')
      let doc = await readSavedContent(page, docId)
      expect(doc.content.startsWith('EDIXY')).toBe(true)

      // 실행 취소 기록 유지 — 거터를 끈 동안 입력한 것도 그 전 입력도 Ctrl+Z 로 되돌아간다
      await page.keyboard.press('Control+z')
      doc = await readSavedContent(page, docId)
      expect(doc.content).not.toContain('XY')
      expect(doc.content.startsWith('EDIT1')).toBe(true)

      await page.keyboard.press('Control+z')
      doc = await readSavedContent(page, docId)
      expect(doc.content.startsWith('EDIT1')).toBe(false) // "EDIT1" 입력 자체도 되돌아간다

      await setLineNumbers(page, '표시')
      await expect(page.locator('.cm-gutters')).toHaveCount(1)
    })
  }
})

test.describe('F-147 A2 스크롤·A3 유지', () => {
  test('F-147 A2 스크롤 위치·A3 유지 — 전환 사이 첫 줄 유지, 숨김은 새로고침·다른 문서에서도 유지', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: longDoc(200) })
    await expect(page.locator('.cm-gutters')).toHaveCount(1)

    const scroller = page.locator('.cm-scroller')
    await scroller.evaluate((el) => {
      el.scrollTop = 3000
    })
    const scrollBefore = await scroller.evaluate((el) => el.scrollTop)

    await setLineNumbers(page, '숨김')
    await expect(page.locator('.cm-gutters')).toHaveCount(0)
    const scrollAfterOff = await scroller.evaluate((el) => el.scrollTop)
    expect(Math.abs(scrollAfterOff - scrollBefore)).toBeLessThanOrEqual(5)

    await setLineNumbers(page, '표시')
    await expect(page.locator('.cm-gutters')).toHaveCount(1)
    const scrollAfterOn = await scroller.evaluate((el) => el.scrollTop)
    expect(Math.abs(scrollAfterOn - scrollBefore)).toBeLessThanOrEqual(5)

    await setLineNumbers(page, '숨김')
    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(page.locator('.cm-gutters')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('md.lineNumbers'))).toBe('off')

    await importMarkdown(page, { content: '문단2\n' })
    await expect(page.locator('.cm-gutters')).toHaveCount(0)
  })
})

// F-147 A4 내용 칸 800px 가운데는 시각 값이라 e2e 에서 뺐다 — specs/human-checks.md (2026-09-25 e2e 경량화)
