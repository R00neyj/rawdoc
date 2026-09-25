// 설정: 줄 번호(거터) 켜기·끄기 (specs/features/F-147.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, setViewMode, resizeWindow, rectOf } from './helpers.js'
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

test.describe('F-147 A1 설정', () => {
  test('마지막 항목 줄 번호, 표시/숨김 두 버튼, 기본 표시', async ({ page }) => {
    await openApp(page)
    await openSettings(page)
    await page.locator('dialog[aria-labelledby="settings-title"]').getByRole('tab', { name: '편집기' }).click() // F-290 — 줄 번호는 편집기 탭

    // F-2037 이 편집기 탭 맨 끝에 `새 문서 템플릿` 을 더해 줄 번호는 끝에서 둘째다
    const labels = page.locator('.settings-panel .dialog-field > span, .settings-panel .dialog-field [id]:not(select)')
    const count = await labels.count()
    await expect(labels.nth(count - 1)).toHaveText('새 문서 템플릿')
    await expect(labels.nth(count - 2)).toHaveText('줄 번호')

    const seg = page.locator(LINE_NUMBERS_LABEL_SCOPE).locator('..').locator('[role="radio"]')
    await expect(seg).toHaveCount(2)
    await expect(seg.nth(0)).toHaveText('표시')
    await expect(seg.nth(1)).toHaveText('숨김')
    await expect(seg.nth(0)).toHaveAttribute('aria-checked', 'true')
    await expect(seg.nth(1)).toHaveAttribute('aria-checked', 'false')
  })
})

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

test.describe('F-147 A2 스크롤 위치', () => {
  test('숨김·표시 전환 사이 편집 없이 보이는 첫 줄이 유지된다', async ({ page }) => {
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
  })
})

test.describe('F-147 A3 유지', () => {
  test('숨김 후 새로고침 — 계속 숨김', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '문단\n' })
    await setLineNumbers(page, '숨김')
    await expect(page.locator('.cm-gutters')).toHaveCount(0)

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(page.locator('.cm-gutters')).toHaveCount(0)
    const persisted = await page.evaluate(() => localStorage.getItem('md.lineNumbers'))
    expect(persisted).toBe('off')
  })

  test('숨김 후 다른 문서를 열어도 계속 숨김', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '문단1\n' })
    await setLineNumbers(page, '숨김')
    await expect(page.locator('.cm-gutters')).toHaveCount(0)

    await importMarkdown(page, { content: '문단2\n' })
    await expect(page.locator('.cm-gutters')).toHaveCount(0)
  })
})

test.describe('F-147 A4 폭', () => {
  test('창 1600px, 숨김 상태 — 내용 칸 800px 가운데, 첫 글자가 칸 왼쪽 끝', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, { content: '문단 글자\n' })
    await setLineNumbers(page, '숨김')
    await expect(page.locator('.cm-gutters')).toHaveCount(0)

    const scrollerRect = await rectOf(page.locator('.cm-scroller'))
    const contentRect = await rectOf(page.locator('.cm-content'))
    expect(contentRect.width).toBeGreaterThanOrEqual(799)
    expect(contentRect.width).toBeLessThanOrEqual(801)

    const scrollerCenter = scrollerRect.left + scrollerRect.width / 2
    const contentCenter = contentRect.left + contentRect.width / 2
    expect(Math.abs(scrollerCenter - contentCenter)).toBeLessThanOrEqual(2)

    const line = page.locator('.cm-line').first()
    const lineRect = await rectOf(line)
    expect(Math.abs(lineRect.left - contentRect.left)).toBeLessThanOrEqual(1)
  })
})
