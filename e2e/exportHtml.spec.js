// HTML 파일·서식 있는 복사 (specs/features/F-280.md) — F-280 A15~A21
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, openExportMenu, EXPORT_BUTTON_LABEL, setPrefBeforeLoad } from './helpers.js'

// 저장 공간 보호 경고(F-118)가 알림을 선점하지 않게 미리 본 것으로 표시해 둔다 — info 는 warn 을 밀어내지 못한다 (e2e/fileDrop.spec.js 와 같은 이유)
async function skipPersistNotice(page) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
}

function u32be(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}
function ascii(s) {
  return Array.from(s).map((c) => c.charCodeAt(0))
}
function pngBytes(width, height) {
  return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32be(13), ...ascii('IHDR'), ...u32be(width), ...u32be(height), 8, 6, 0, 0, 0]
}

async function pasteFiles(page, { targetSelector = '.cm-content', files }) {
  await page.evaluate(
    ({ targetSelector, files }) => {
      const dt = new DataTransfer()
      for (const f of files) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.mime }))
      const el = document.querySelector(targetSelector)
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    },
    { targetSelector, files },
  )
}

async function fillTitle(page, text) {
  await page.locator('.doc-title').fill(text)
  await page.locator('.doc-title').blur()
}

async function downloadText(page, menuitemName) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: menuitemName, exact: true }).click(),
  ])
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return { filename: download.suggestedFilename(), text: Buffer.concat(chunks).toString('utf-8') }
}

test.describe('F-280 HTML 파일·서식 있는 복사', () => {
  test('F-280 A15·A16·A17·A18, F-293 A12 메뉴 포커스·Escape, HTML 다운로드(doctype·style·title·이미지 data URI·Mermaid svg·머리줄 없음)', async ({ page }) => {
    await openApp(page)
    const content =
      '# 제목\n\n- 목록1\n- 목록2\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n' +
      '```mermaid\ngraph TD; A-->B;\n```\n\n```js\nalert(1)\n```\n\n본문\n'
    await importMarkdown(page, { name: 'doc.md', content })
    await fillTitle(page, '내보내기 문서')
    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await pasteFiles(page, { files: [{ bytes: pngBytes(20, 20), name: 'a.png', mime: 'image/png' }] })
    await expect(page.locator('.md-image-box')).toBeVisible()

    const btn = page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })
    const items = await openExportMenu(page)
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    await expect(items.nth(0)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(btn).toBeFocused()

    await openExportMenu(page)
    const { filename, text } = await downloadText(page, 'HTML 파일')
    expect(filename).toBe('내보내기 문서.html')
    expect(text.startsWith('<!doctype html>')).toBe(true)
    expect(text).toContain('<style>')
    expect(text).toContain('<title>내보내기 문서</title>')
    expect(text).not.toMatch(/<script/i)
    expect(text).toContain('src="data:image/png;base64,')
    expect(text).not.toContain('data-attachment')
    expect(text).toContain('<svg')
    expect(text).not.toContain('data-mermaid-source')
    expect(text).not.toContain('class="md-code"')
    expect(text).not.toContain('class="md-code-head"')
    expect(text).not.toContain('class="md-code-lang"')
    expect(text).not.toContain('class="code-copy-btn"')
    expect(text).toContain('<pre><code class="language-')
  })

  test('F-280 A19·A20·A21 서식 있는 복사(text/html·text/plain), ClipboardItem 없으면 평문 대체, 문서가 없으면 내보내기 비활성', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await skipPersistNotice(page)
    await openApp(page)
    await importMarkdown(page, { content: '# 제목\n\n**굵게**\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n' })

    await openExportMenu(page)
    await page.getByRole('menuitem', { name: '서식 있는 복사', exact: true }).click()
    await expect(page.locator('.notice--info .notice-message')).toHaveText('서식을 포함해 복사했습니다.')
    const result = await page.evaluate(async () => {
      const item = (await navigator.clipboard.read())[0]
      const html = item.types.includes('text/html') ? await (await item.getType('text/html')).text() : null
      const plain = item.types.includes('text/plain') ? await (await item.getType('text/plain')).text() : null
      return { types: item.types, html, plain }
    })
    expect(result.types).toContain('text/html')
    expect(result.types).toContain('text/plain')
    expect(result.html).toContain('<h1')
    expect(result.html).toContain('<strong')
    expect(result.html).toContain('border-collapse')
    expect(result.plain).not.toContain('**')
    expect(result.plain).not.toContain('#')

    await page.evaluate(() => {
      // @ts-ignore
      delete window.ClipboardItem
    })
    await openExportMenu(page)
    await page.getByRole('menuitem', { name: '서식 있는 복사', exact: true }).click()
    await expect(page.locator('.notice--warn .notice-message')).toHaveText('서식 없이 글만 복사했습니다.')
    const plain = await page.evaluate(() => navigator.clipboard.readText())
    expect(plain).not.toContain('#')
    expect(plain).toContain('제목')

    for (let i = 0; i < 5 && (await page.locator('.tree-row').count()) > 0; i++) {
      const row = page.locator('.tree-row').first()
      await row.hover()
      await row.locator('.item-menu-btn').click()
      await page.getByRole('menuitem', { name: /삭제/ }).click()
      await page.getByRole('button', { name: '삭제', exact: true }).click()
      await expect(page.locator('.dialog[open]')).toHaveCount(0)
    }
    const btn = page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })
    await expect(btn).toBeDisabled()
    await btn.click({ force: true })
    await expect(page.getByRole('menu')).toHaveCount(0)
  })
})
