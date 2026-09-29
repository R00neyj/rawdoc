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

async function deleteFirstDoc(page) {
  const row = page.locator('.tree-row').first()
  await row.hover()
  await row.locator('.item-menu-btn').click()
  await page.getByRole('menuitem', { name: /삭제/ }).click()
  await page.getByRole('button', { name: '삭제', exact: true }).click()
}

// F-279 A3 메뉴 항목·A4 키보드 순회는 e2e/export.spec.js 한 곳이 보고, A10 인쇄 미디어 배치는 시각 값이라 specs/human-checks.md 로 옮겼다
test('F-279 A5·A11 빈 상태에서는 버튼 비활성·메뉴 안 열림, Ctrl+P 는 인쇄를 안 부르고 팔레트에 PDF 없음', async ({ page }) => {
  await stubPrint(page)
  await openApp(page)
  await deleteFirstDoc(page) // 첫 실행 안내 문서를 지워 빈 상태를 만든다 (F-278 A20 와 같은 방식)
  const btn = page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })
  await expect(btn).toBeDisabled()
  await btn.click({ force: true })
  await expect(page.getByRole('menu')).toHaveCount(0)

  await page.keyboard.press('Control+p')
  await page.waitForTimeout(300)

  expect(await printCallCount(page)).toBe(0)
  // 홈 화면에는 F-2054 이동·만들기·보기 명령이 보인다 — PDF (A4 인쇄) 만 없다
  await expect(page.getByRole('option', { name: 'PDF (A4 인쇄)' })).toHaveCount(0)
})

test('F-279 A6·A7·A8·A9·A11·F-293 A13 인쇄 호출·인쇄 중 상태·이미지·Mermaid·머리줄 없음·복원, Ctrl+P 는 팔레트로', async ({ page }) => {
  await stubPrint(page)
  await openApp(page)
  await importMarkdown(page, { content: '## 소개\n\n본문\n\n```mermaid\ngraph TD; A-->B\n```\n\n```js\nalert(1)\n```\n' })
  await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
  await pasteFiles(page, { files: [{ bytes: pngBytes(20, 20), name: 'a.png', mime: 'image/png' }] })
  await expect(page.locator('.md-image-box')).toBeVisible()
  await fillTitle(page, '인쇄 문서')

  const prevTitle = await page.title()
  const prevTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))

  await triggerPrint(page)

  // A6 — 1번 불리고 그 시점에 인쇄 영역이 채워진다
  await expect.poll(() => printCallCount(page)).toBe(1)
  await expect(page.locator('.print-root .markdown-body h2')).toHaveText('소개')
  await expect(page.locator('.print-root .doc-title-view')).toHaveText('인쇄 문서')

  // A7 — 인쇄 중 title·data-printing, data-theme 없음
  const snapshot = await page.evaluate(() => window.printLog.snapshots[0])
  expect(snapshot.title).toBe('인쇄 문서')
  expect(snapshot.printing).toBe('1')
  expect(snapshot.theme).toBeNull()

  // A9 — 이미지 blob URL·mermaid svg
  await expect(page.locator('.print-root .md-mermaid svg')).toHaveCount(1)
  const src = await page.locator('.print-root img[data-attachment]').getAttribute('src')
  expect(src).toMatch(/^blob:/)

  // F-293 A13 — 인쇄 영역에 머리줄·복사 버튼 없음
  await expect(page.locator('.print-root .md-code-head')).toHaveCount(0)
  await expect(page.locator('.print-root .code-copy-btn')).toHaveCount(0)
  await expect(page.locator('.print-root pre')).not.toHaveCount(0)

  // A8 — afterprint 뒤 원래대로
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect.poll(() => page.title()).toBe(prevTitle)
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(prevTheme)
  await expect(page.locator('html')).not.toHaveAttribute('data-printing', '1')
  await expect.poll(() => page.locator('.print-root').evaluate((el) => el.childElementCount)).toBe(0)

  // A11 — Ctrl+P 는 인쇄 대신 명령 팔레트를 연다
  await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
  await page.keyboard.press('Control+p')
  expect(await printCallCount(page)).toBe(1)
  await expect(page.locator('dialog[open] .command-palette')).toBeVisible()
  await page.getByRole('option', { name: 'PDF (A4 인쇄)' }).click()
  await expect.poll(() => printCallCount(page)).toBe(2)
  await expect(page.locator('.print-root .markdown-body h2')).toHaveText('소개')
})
