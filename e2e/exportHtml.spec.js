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

test.describe('F-280 A15 메뉴 항목', () => {
  test('.md·.txt (평문)·HTML 파일·PDF (A4 인쇄)·서식 있는 복사 순서, 포커스·Escape', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })

    const btn = page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })
    const items = await openExportMenu(page)
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    await expect(items).toHaveText(['.md', '.txt (평문)', 'HTML 파일', 'PDF (A4 인쇄)', '서식 있는 복사'])
    await expect(items.nth(0)).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(btn).toBeFocused()
  })
})

test.describe('F-280 A16 .html 다운로드', () => {
  test('제목·목록·표가 있는 문서 — doctype·style·title, script 없음', async ({ page }) => {
    await openApp(page)
    const content = '# 제목\n\n- 목록1\n- 목록2\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    await importMarkdown(page, { name: 'doc.md', content })
    await fillTitle(page, '내보내기 문서')

    await openExportMenu(page)
    const { filename, text } = await downloadText(page, 'HTML 파일')

    expect(filename).toBe('내보내기 문서.html')
    expect(text.startsWith('<!doctype html>')).toBe(true)
    expect(text).toContain('<style>')
    expect(text).toContain('<title>내보내기 문서</title>')
    expect(text).not.toMatch(/<script/i)
  })
})

test.describe('F-280 A17 이미지 인라인', () => {
  test('PNG 를 붙여넣은 문서 — data: URI 로 들어간다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await pasteFiles(page, { files: [{ bytes: pngBytes(20, 20), name: 'a.png', mime: 'image/png' }] })
    await expect(page.locator('.md-image-box')).toBeVisible()

    await openExportMenu(page)
    const { text } = await downloadText(page, 'HTML 파일')

    expect(text).toContain('src="data:image/png;base64,')
    expect(text).not.toContain('data-attachment')
  })
})

test.describe('F-280 A18 Mermaid', () => {
  test('mermaid 코드블록 — 그려진 svg 가 들어간다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '```mermaid\ngraph TD; A-->B;\n```\n' })

    await openExportMenu(page)
    const { text } = await downloadText(page, 'HTML 파일')

    expect(text).toContain('<svg')
    expect(text).not.toContain('data-mermaid-source')
  })
})

test.describe('F-280 A19 서식 있는 복사', () => {
  test('text/html·text/plain 을 함께 쓴다', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await skipPersistNotice(page)
    await openApp(page)
    await importMarkdown(page, { content: '# 제목\n\n**굵게**\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n' })

    await openExportMenu(page)
    await page.getByRole('menuitem', { name: '서식 있는 복사', exact: true }).click()

    await expect(page.locator('.notice--info .notice-message')).toHaveText('서식을 포함해 복사했습니다.')

    const result = await page.evaluate(async () => {
      const items = await navigator.clipboard.read()
      const item = items[0]
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
  })
})

test.describe('F-280 A20 복사 대체 경로', () => {
  test('ClipboardItem 이 없으면 평문으로 떨어진다', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.addInitScript(() => {
      // @ts-ignore
      delete window.ClipboardItem
    })
    await openApp(page)
    await importMarkdown(page, { content: '# 제목\n\n본문\n' })

    await openExportMenu(page)
    await page.getByRole('menuitem', { name: '서식 있는 복사', exact: true }).click()

    await expect(page.locator('.notice--warn .notice-message')).toHaveText('서식 없이 글만 복사했습니다.')
    const plain = await page.evaluate(() => navigator.clipboard.readText())
    expect(plain).not.toContain('#')
    expect(plain).toContain('제목')
    expect(plain).toContain('본문')
  })
})

test.describe('F-293 A12 내보낸 HTML에 머리줄 없음', () => {
  test('코드블록이 있어도 md-code-head·md-code-lang·code-copy-btn 요소가 없고 pre>code 는 그대로', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '```js\nalert(1)\n```\n' })

    await openExportMenu(page)
    const { text } = await downloadText(page, 'HTML 파일')

    // <style> 안에는 선택자 문자열이 죽은 규칙으로 남는다(F-293 3.6) — 실제 DOM 요소만 본다
    expect(text).not.toContain('class="md-code"')
    expect(text).not.toContain('class="md-code-head"')
    expect(text).not.toContain('class="md-code-lang"')
    expect(text).not.toContain('class="code-copy-btn"')
    expect(text).toContain('<pre><code class="language-')
  })
})

test.describe('F-280 A21 비활성 회귀', () => {
  test('문서가 없는 빈 상태에서는 내보내기 버튼이 비활성, 메뉴가 열리지 않는다', async ({ page }) => {
    await openApp(page)
    const row = page.locator('.tree-row').first()
    await row.hover()
    await row.locator('.item-menu-btn').click()
    await page.getByRole('menuitem', { name: /삭제/ }).click()
    await page.getByRole('button', { name: '삭제', exact: true }).click()

    const btn = page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })
    await expect(btn).toBeDisabled()
    await btn.click({ force: true })
    await expect(page.getByRole('menu')).toHaveCount(0)
  })
})
