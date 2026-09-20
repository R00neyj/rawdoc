// PDF (A4 인쇄) — 상단바 내보내기 메뉴, Ctrl+P (specs/features/F-279.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, openExportMenu, EXPORT_BUTTON_LABEL } from './helpers.js'

function u32be(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}
function ascii(s) {
  return Array.from(s).map((c) => c.charCodeAt(0))
}
function pngBytes(width, height) {
  return [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...u32be(13),
    ...ascii('IHDR'),
    ...u32be(width),
    ...u32be(height),
    8, 6, 0, 0, 0,
  ]
}

async function pasteFiles(page, { targetSelector = '.cm-content', files }) {
  await page.evaluate(
    ({ targetSelector, files }) => {
      const dt = new DataTransfer()
      for (const f of files) {
        dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.mime }))
      }
      const el = document.querySelector(targetSelector)
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    },
    { targetSelector, files },
  )
}

// window.print 를 기록용으로 바꿔 끼운다 (specs/features/F-279.md 8장) — 실제 인쇄 창은 열지 않는다
async function stubPrint(page) {
  await page.addInitScript(() => {
    window.printLog = { calls: 0, snapshots: [] }
    window.print = () => {
      window.printLog.calls += 1
      window.printLog.snapshots.push({
        title: document.title,
        theme: document.documentElement.getAttribute('data-theme'),
        printing: document.documentElement.getAttribute('data-printing'),
      })
    }
  })
}

async function printCallCount(page) {
  return page.evaluate(() => window.printLog?.calls ?? 0)
}

async function fillTitle(page, text) {
  await page.locator('.doc-title').fill(text)
  await page.locator('.doc-title').blur()
}

async function triggerPrint(page) {
  await openExportMenu(page)
  await page.getByRole('menuitem', { name: 'PDF (A4 인쇄)', exact: true }).click()
}

test.describe('F-279 A3 메뉴 항목', () => {
  test('내보내기 메뉴에 항목 3개가 순서대로 있다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    const items = await openExportMenu(page)
    await expect(items).toHaveText(['.md', '.txt (평문)', 'PDF (A4 인쇄)'])
  })
})

test.describe('F-279 A4 키보드 순회', () => {
  test('ArrowDown 3번이면 첫 항목으로 순환한다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    const items = await openExportMenu(page)
    await expect(items.nth(0)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(2)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(0)).toBeFocused()
  })
})

async function deleteFirstDoc(page) {
  const row = page.locator('.tree-row').first()
  await row.hover()
  await row.locator('.item-menu-btn').click()
  await page.getByRole('menuitem', { name: /삭제/ }).click()
  await page.getByRole('button', { name: '삭제', exact: true }).click()
}

test.describe('F-279 A5 비활성', () => {
  test('문서가 없는 빈 상태에서는 내보내기 버튼이 비활성, 메뉴가 열리지 않는다', async ({ page }) => {
    await openApp(page)
    await deleteFirstDoc(page) // 첫 실행 안내 문서를 지워 빈 상태를 만든다 (F-278 A20 와 같은 방식)
    const btn = page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })
    await expect(btn).toBeDisabled()
    await btn.click({ force: true })
    await expect(page.getByRole('menu')).toHaveCount(0)
  })
})

test.describe('F-279 A6 인쇄 호출', () => {
  test('window.print 가 1번 불리고 그 시점에 인쇄 영역에 제목·본문이 채워진다', async ({ page }) => {
    await stubPrint(page)
    await openApp(page)
    await importMarkdown(page, { content: '## 소개\n\n본문\n' })
    await fillTitle(page, '인쇄 문서')

    await triggerPrint(page)

    await expect.poll(() => printCallCount(page)).toBe(1)
    await expect(page.locator('.print-root .markdown-body h2')).toHaveText('소개')
    await expect(page.locator('.print-root .doc-title-view')).toHaveText('인쇄 문서')
  })
})

test.describe('F-279 A7 인쇄 중 상태', () => {
  test('document.title·data-printing 이 바뀌고 data-theme 가 없다', async ({ page }) => {
    await stubPrint(page)
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await fillTitle(page, '인쇄 문서')

    await triggerPrint(page)
    await expect.poll(() => printCallCount(page)).toBe(1)

    const snapshot = await page.evaluate(() => window.printLog.snapshots[0])
    expect(snapshot.title).toBe('인쇄 문서')
    expect(snapshot.printing).toBe('1')
    expect(snapshot.theme).toBeNull()
  })
})

test.describe('F-279 A8 되돌리기', () => {
  test('afterprint 뒤 title·data-theme·data-printing·print-root 가 원래대로', async ({ page }) => {
    await stubPrint(page)
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await fillTitle(page, '인쇄 문서')

    const prevTitle = await page.title()
    const prevTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))

    await triggerPrint(page)
    await expect.poll(() => printCallCount(page)).toBe(1)

    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))

    await expect.poll(() => page.title()).toBe(prevTitle)
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
      .toBe(prevTheme)
    await expect(page.locator('html')).not.toHaveAttribute('data-printing', '1')
    await expect
      .poll(() => page.locator('.print-root').evaluate((el) => el.childElementCount))
      .toBe(0)
  })
})

test.describe('F-279 A9 이미지·Mermaid 준비', () => {
  test('print 호출 시점에 이미지 blob URL 과 mermaid svg 가 채워져 있다', async ({ page }) => {
    await stubPrint(page)
    await openApp(page)
    await importMarkdown(page, { content: '본문\n\n```mermaid\ngraph TD; A-->B\n```\n' })
    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await pasteFiles(page, { files: [{ bytes: pngBytes(20, 20), name: 'a.png', mime: 'image/png' }] })
    await expect(page.locator('.md-image-box')).toBeVisible()

    await triggerPrint(page)
    await expect.poll(() => printCallCount(page)).toBe(1)

    await expect(page.locator('.print-root .md-mermaid svg')).toHaveCount(1)
    const src = await page.locator('.print-root img[data-attachment]').getAttribute('src')
    expect(src).toMatch(/^blob:/)
  })
})

test.describe('F-279 A10 인쇄 미디어 구조', () => {
  test('emulateMedia print 면 app-body 가 숨고 print-root 가 화면 안으로, 되돌리면 반대', async ({ page }) => {
    await stubPrint(page)
    await openApp(page)
    await importMarkdown(page, { content: '## 소개\n\n본문\n' })

    await triggerPrint(page)
    await expect.poll(() => printCallCount(page)).toBe(1)

    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('.app-body')).toBeHidden()
    const printBox = await page.locator('.print-root').boundingBox()
    expect(printBox).not.toBeNull()
    expect(printBox.x).toBeGreaterThanOrEqual(0)

    await page.emulateMedia({ media: null })
    await expect(page.locator('.app-body')).toBeVisible()
    const offBox = await page.locator('.print-root').boundingBox()
    expect(offBox.x).toBeLessThan(0)
  })
})

test.describe('F-279 A11 Ctrl+P', () => {
  test('편집 영역에 포커스가 있어도 인쇄된다', async ({ page }) => {
    await stubPrint(page)
    await openApp(page)
    await importMarkdown(page, { content: '## 소개\n\n본문\n' })
    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()

    await page.keyboard.press('Control+p')

    await expect.poll(() => printCallCount(page)).toBe(1)
    await expect(page.locator('.print-root .markdown-body h2')).toHaveText('소개')
  })

  test('빈 상태에서는 인쇄를 부르지 않는다', async ({ page }) => {
    await stubPrint(page)
    await openApp(page)
    await deleteFirstDoc(page) // 첫 실행 안내 문서를 지워 빈 상태를 만든다

    await page.keyboard.press('Control+p')
    await page.waitForTimeout(300)

    expect(await printCallCount(page)).toBe(0)
  })
})
