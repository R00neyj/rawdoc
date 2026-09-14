// 끌어놓기로 .md 열기(specs/features/F-145.md) — 실제 OS 파일 끌어놓기는 도구로 못 내 합성 DragEvent 로 확인한다 (3장 머리말)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, readSavedContent, setPrefBeforeLoad } from './helpers.js'

// 저장 공간 보호 경고(F-118)가 알림을 선점하지 않게 미리 본 것으로 표시해 둔다 — info 는 warn 을 밀어내지 못한다
async function skipPersistNotice(page) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
}

// targetSelector 에서 시작해 window 까지 버블되는 합성 드래그 이벤트를 보낸다. 반환값은 dispatchEvent 결과(false = preventDefault 됨)
async function dispatchDrag(page, { targetSelector, type, files = [], text, clientX, clientY }) {
  return page.evaluate(
    ({ targetSelector, type, files, text, clientX, clientY }) => {
      const dt = new DataTransfer()
      for (const f of files) {
        dt.items.add(new File([f.content ?? ''], f.name, { type: 'text/markdown' }))
      }
      if (typeof text === 'string') dt.setData('text/plain', text)
      const el = document.querySelector(targetSelector)
      const init = { bubbles: true, cancelable: true, dataTransfer: dt }
      if (typeof clientX === 'number') init.clientX = clientX
      if (typeof clientY === 'number') init.clientY = clientY
      return el.dispatchEvent(new DragEvent(type, init))
    },
    { targetSelector, type, files, text, clientX, clientY },
  )
}

async function dragEnter(page, targetSelector, files) {
  return dispatchDrag(page, { targetSelector, type: 'dragenter', files })
}
async function dragOver(page, targetSelector, files) {
  return dispatchDrag(page, { targetSelector, type: 'dragover', files })
}
async function dragLeave(page, targetSelector, files) {
  return dispatchDrag(page, { targetSelector, type: 'dragleave', files })
}
async function drop(page, targetSelector, files) {
  return dispatchDrag(page, { targetSelector, type: 'drop', files })
}

const MD_FILE = { name: 'a.md', content: '# 안녕\n본문\n' }

test.describe('F-145 .md 파일 끌어놓아 열기', () => {
  test('F-145 A2 사이드바 위에 한 파일 놓기 — 새 문서, 원문 동일, 열림, 알림', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)
    const before = await currentDocId(page)

    await dragEnter(page, '.sidebar', [MD_FILE])
    await drop(page, '.sidebar', [MD_FILE])

    await expect.poll(async () => currentDocId(page)).not.toBe(before)
    await expect(page.locator('.doc-title')).toHaveValue('a')
    await expect(page.locator('.notice-message')).toHaveText('"a.md" 을(를) 가져왔습니다.')

    const saved = await readSavedContent(page)
    expect(saved.content).toBe(MD_FILE.content)
  })

  test('F-145 A3 편집 영역 위에 여러 파일 — md 만 문서로, 마지막이 열림, 본문에 삽입 없음', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '기존 문서\n' })
    const before = await currentDocId(page)
    const countBefore = await page.locator('.tree-row').count()

    const files = [
      { name: 'a.md', content: 'A 내용\n' },
      { name: 'b.md', content: 'B 내용\n' },
      { name: 'c.txt', content: '텍스트\n' },
    ]
    await dragEnter(page, '.cm-content', files)
    await drop(page, '.cm-content', files)

    await expect.poll(async () => currentDocId(page)).not.toBe(before)
    await expect(page.locator('.doc-title')).toHaveValue('b')
    await expect(page.locator('.tree-row')).toHaveCount(countBefore + 2)

    // 편집 영역에 파일 글자가 삽입되지 않았다 — 새로 연 문서(b.md) 본문 그대로
    const editorText = await page.locator('.cm-content').innerText()
    expect(editorText).toContain('B 내용')
    expect(editorText).not.toContain('텍스트')
  })

  test('F-145 A4 비 .md 만 놓으면 문서 생성 없음, 안내 알림', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)
    const before = await currentDocId(page)
    const countBefore = await page.locator('.tree-row').count()

    const files = [{ name: 'c.txt', content: '텍스트\n' }]
    await dragEnter(page, '.sidebar', files)
    await drop(page, '.sidebar', files)

    expect(await currentDocId(page)).toBe(before)
    expect(await page.locator('.tree-row').count()).toBe(countBefore)
    await expect(page.locator('.notice-message')).toHaveText('마크다운(.md) 파일만 가져올 수 있습니다.')
  })

  test('F-145 A5 덮개 — 자식 사이 이동에도 유지, dragleave·drop·Esc 로 사라짐', async ({ page }) => {
    await openApp(page)
    const overlay = page.locator('.drop-overlay')

    await dragEnter(page, '.sidebar', [MD_FILE])
    await expect(overlay).toBeVisible()

    // 자식 요소 사이 이동(진입 카운트 증가) — 깜빡이지 않고 계속 보인다
    await dragOver(page, '.topbar', [MD_FILE])
    await dragEnter(page, '.cm-content', [MD_FILE])
    await expect(overlay).toBeVisible()
    await dragLeave(page, '.sidebar', [MD_FILE])
    await expect(overlay).toBeVisible() // 아직 cm-content 진입이 남아 있다

    await dragLeave(page, '.cm-content', [MD_FILE]) // 창 밖으로 나간 것과 동등 — 진입 카운트 0
    await expect(overlay).toBeHidden()

    // drop 으로 사라짐
    await dragEnter(page, '.sidebar', [MD_FILE])
    await expect(overlay).toBeVisible()
    await drop(page, '.sidebar', [MD_FILE])
    await expect(overlay).toBeHidden()

    // Esc 로 사라짐
    await dragEnter(page, '.sidebar', [MD_FILE])
    await expect(overlay).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(overlay).toBeHidden()
  })

  test('F-145 A6 대화상자가 열려 있으면 받지 않는다', async ({ page }) => {
    await openApp(page)
    const before = await currentDocId(page)
    await page.getByRole('button', { name: '설정', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '설정' })
    await expect(dialog).toBeVisible()

    await dragEnter(page, 'dialog[open]', [MD_FILE])
    await expect(page.locator('.drop-overlay')).toBeHidden()
    await drop(page, 'dialog[open]', [MD_FILE])

    expect(await currentDocId(page)).toBe(before)
    await expect(dialog).toBeVisible() // 대화상자도 그대로
  })

  test('F-145 A6 공유 화면(S-4)에서 놓으면 받지 않는다', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    await importMarkdown(page, { content: '공유용 문서\n' })
    const docCountBefore = await page.locator('.tree-row').count()

    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await page.getByRole('menuitem', { name: '링크 복사' }).click()
    const link = await page.evaluate(() => navigator.clipboard.readText())
    const hash = new URL(link).hash
    await page.evaluate((h) => {
      location.hash = h
    }, hash)
    await expect(page.locator('.shared-view')).toBeVisible()

    const overNotPrevented = await dragOver(page, '.shared-view', [MD_FILE])
    expect(overNotPrevented).toBe(false) // dispatchEvent 반환 false = preventDefault 됨 — 브라우저 기본 파일 열기를 막는다 (2.1)
    await expect(page.locator('.drop-overlay')).toBeHidden()

    const dropNotPrevented = await drop(page, '.shared-view', [MD_FILE])
    expect(dropNotPrevented).toBe(false)

    expect(await page.locator('.tree-row').count()).toBe(docCountBefore)
    await expect(page.locator('.shared-view')).toBeVisible() // 공유 화면도 그대로
  })

  test('F-145 A7 회귀 — 가져오기 버튼, 사이드바 안 문서 끌기(text/plain)는 그대로 동작', async ({ page }) => {
    await openApp(page)
    // 가져오기 버튼 (input[type=file], F-114 경로 — 이 명세가 손대지 않은 경로)
    await importMarkdown(page, { name: '버튼.md', content: '버튼으로 가져옴\n' })
    await expect(page.locator('.doc-title')).toHaveValue('버튼')

    // 사이드바 안 문서 끌기는 text/plain 만 써서 외부 파일 판정에 걸리지 않는다 — 덮개가 뜨지 않는다
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.setData('text/plain', 'doc-id')
      const row = document.querySelector('.tree-row')
      row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
      row.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })
    await expect(page.locator('.drop-overlay')).toBeHidden()
  })

  test('F-145 A7 회귀 — 다른 곳 글자(text/plain) 끌어오기는 본문에 들어가고 덮개는 안 뜬다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '시작\n' })
    const content = page.locator('.cm-content')
    const box = await content.boundingBox()

    await dispatchDrag(page, {
      targetSelector: '.cm-content',
      type: 'dragover',
      text: '외부글자',
      clientX: box.x + 10,
      clientY: box.y + 10,
    })
    await dispatchDrag(page, {
      targetSelector: '.cm-content',
      type: 'drop',
      text: '외부글자',
      clientX: box.x + 10,
      clientY: box.y + 10,
    })

    await expect(page.locator('.drop-overlay')).toBeHidden()
    await expect(content).toContainText('외부글자')
  })
})
