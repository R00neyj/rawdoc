// 새 문서 템플릿 (specs/features/F-2037.md)
import { test, expect } from '@playwright/test'
import { openApp, openAppHome, importMarkdown, readSavedContent, currentDocId, setPrefBeforeLoad, waitSaved } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const FIXED_NOW = new Date(2026, 8, 25, 9, 5, 7) // 2026-09-25 09:05:07 금요일 (F-2037.md 머리 확인 (a))

const MEETING_CRLF = '## 회의 — 2026-09-25\r\n\r\n- 참석:\r\n- 안건:\r\n\r\n### 논의\r\n\r\n### 결정\r\n\r\n### 할 일\r\n\r\n- [ ] '
const BUG_CRLF = '## 버그 보고\r\n\r\n- 환경:\r\n- 기대한 동작:\r\n- 실제 동작:\r\n\r\n### 재현 순서\r\n\r\n1. '
const DAILY_CRLF = '---\r\ndate: 2026-09-25\r\n---\r\n\r\n## 2026-09-25\r\n\r\n### 한 일\r\n\r\n- \r\n\r\n### 할 일\r\n\r\n- [ ] '

const SETTINGS_DIALOG_SELECTOR = 'dialog[aria-labelledby="settings-title"]'
const palette = (page) => page.locator('dialog[open] .command-palette')

async function openSettings(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  return page.locator(SETTINGS_DIALOG_SELECTOR)
}

async function openEditorTab(page) {
  const dialog = await openSettings(page)
  await dialog.getByRole('tab', { name: '편집기' }).click()
  return dialog
}

async function closeSettings(page) {
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(page.locator(SETTINGS_DIALOG_SELECTOR)).toBeHidden()
}

async function fillTitle(page, text) {
  await page.locator('.doc-title').fill(text)
  await page.locator('.doc-title').blur()
}

async function newTopFolder(page, name) {
  await page.locator('.sidebar').getByRole('button', { name: '새 폴더', exact: true }).click()
  const input = page.locator('.tree-rename-input')
  await input.fill(name)
  await input.press('Enter')
}

async function newDocInFolder(page, folderName) {
  await page.locator('.tree-row').filter({ hasText: folderName }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: '새 문서' }).click()
  await expect(page.locator('.doc-title')).toBeVisible()
}

async function moveCurrentDocToFolder(page, folderName) {
  const docRow = page.locator('.tree-row').filter({ has: page.locator('.doc-item-btn[aria-current="page"]') })
  await docRow.hover()
  await docRow.locator('.item-menu-btn').click()
  await page.getByRole('menuitem', { name: '폴더로 이동…' }).click()
  const dialog = page.locator('.dialog[open]')
  await dialog.getByRole('radio', { name: folderName, exact: true }).click()
  await dialog.getByRole('button', { name: '이동', exact: true }).click()
  await expect(page.locator('.dialog[open]')).toHaveCount(0)
  await page.waitForTimeout(50)
}

async function deleteCurrentDoc(page) {
  const docRow = page.locator('.tree-row').filter({ has: page.locator('.doc-item-btn[aria-current="page"]') })
  await docRow.hover()
  await docRow.locator('.item-menu-btn').click()
  await page.getByRole('menuitem', { name: '삭제' }).click()
  const dialog = page.locator('.dialog[open]')
  await dialog.getByRole('button', { name: '삭제', exact: true }).click()
  await expect(page.locator('.dialog[open]')).toHaveCount(0)
}

// F-2022 A18 과 같은 방법 — 앱 목록에는 남지만 저장소 레코드만 지운다
async function deleteDocRecord(page, id) {
  await page.evaluate(
    (docId) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('docs', 'readwrite')
          tx.objectStore('docs').delete(docId)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }
      }),
    id,
  )
}

async function selectNewDocTemplateByLabel(page, label) {
  const dialog = await openEditorTab(page)
  await dialog.getByRole('combobox', { name: '새 문서 템플릿' }).selectOption({ label })
  await closeSettings(page)
}

// 최상위 템플릿 폴더 + 문서 하나(## {{title}}\n\n- ) 만들고 설정에서 그 템플릿을 고른다 (F-2037.md A6 준비)
async function setupUserTemplate(page) {
  await newTopFolder(page, '템플릿')
  await newDocInFolder(page, '템플릿')
  await fillTitle(page, '노트 틀')
  await page.locator('.cm-content').click()
  await page.keyboard.type('## {{title}}\n\n- ')
  await waitSaved(page)
  const templateDocId = await currentDocId(page)
  await selectNewDocTemplateByLabel(page, '노트 틀 (템플릿)')
  return templateDocId
}

test.describe('F-2037 새 문서 템플릿', () => {
  test('A5·A2·A3·A4·A8·A12 없음 → 설정 저장 → 사이드바·폴더 새 문서 → 제목 Enter 뒤 Ctrl+Z → 가져오기', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await openApp(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await expect(page.locator('.doc-title')).toBeVisible()
    expect((await readSavedContent(page)).content).toBe('')

    const dialog = await openEditorTab(page)
    await dialog.getByRole('combobox', { name: '새 문서 템플릿' }).selectOption({ label: '회의록' })
    await closeSettings(page)
    await page.reload()
    const dialog2 = await openEditorTab(page)
    await expect(dialog2.getByRole('combobox', { name: '새 문서 템플릿' })).toHaveValue('builtin:meeting')
    expect(await page.evaluate(() => localStorage.getItem('md.newDocTemplate'))).toBe('builtin:meeting')
    await closeSettings(page)

    await page.getByRole('button', { name: '새 문서' }).click()
    const titleInput = page.locator('.doc-title')
    await expect(titleInput).toBeFocused()
    expect((await readSavedContent(page)).content).toBe(MEETING_CRLF)
    await expect(titleInput).toHaveValue('제목 없는 문서')
    const sel = await titleInput.evaluate((el) => ({ start: el.selectionStart, end: el.selectionEnd, len: el.value.length }))
    expect(sel.start).toBe(0)
    expect(sel.end).toBe(sel.len)

    await titleInput.press('Enter')
    await page.keyboard.press('Control+z')
    expect((await readSavedContent(page)).content).toBe(MEETING_CRLF)

    await selectNewDocTemplateByLabel(page, '버그 보고')
    await newTopFolder(page, '일반')
    await newDocInFolder(page, '일반')
    expect((await readSavedContent(page)).content).toBe(BUG_CRLF)

    await importMarkdown(page, { content: '가져온 글\n' })
    expect((await readSavedContent(page)).content).toBe('가져온 글\n')
  })

  test('F-2037 A4 빈 화면 새 문서 — 버그 보고 템플릿', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.newDocTemplate', 'builtin:bug')
    await openAppHome(page)
    await page.locator('.empty-state').getByRole('button', { name: '새 문서' }).click()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    expect((await readSavedContent(page)).content).toBe(BUG_CRLF)
  })

  test('A7·A7b·A6·A11 사용자 템플릿 — 새 문서 버튼·팔레트 삽입·링크 제목 치환·읽기 실패', async ({ page }) => {
    await openApp(page)
    const templateDocId = await setupUserTemplate(page)

    await page.getByRole('button', { name: '새 문서' }).click()
    await expect(page.locator('.doc-title')).toBeVisible()
    expect((await readSavedContent(page)).content).toBe('## \r\n\r\n- ')

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Control+p')
    await page.keyboard.type('>')
    await page.keyboard.press('Enter')
    await palette(page).locator('.command-palette-input').fill('노트 틀')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await readSavedContent(page)).content).toContain('## 제목 없는 문서')

    await importMarkdown(page, { content: '[[새 링크]]\n\n본문\n' })
    await page.locator('.cm-content').getByText('본문', { exact: true }).click()
    await page.locator('.cm-content .md-wikilink').filter({ hasText: '새 링크' }).click()
    await expect(page.locator('.doc-title')).toHaveValue('새 링크')
    expect((await readSavedContent(page)).content).toBe('## 새 링크\r\n\r\n- ')

    await deleteDocRecord(page, templateDocId)
    const before = await currentDocId(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await expect.poll(() => currentDocId(page)).not.toBe(before)
    expect((await readSavedContent(page)).content).toBe('')
    await expect(page.locator('.notice--error .notice-message')).toHaveText('새 문서 템플릿을 읽지 못해 빈 문서로 만들었습니다.')
  })

  test('A9·A10 템플릿을 폴더 밖으로, 템플릿 문서 삭제 — 빈 문서·알림 없음', async ({ page }) => {
    await openApp(page)
    const templateDocId = await setupUserTemplate(page)
    await newTopFolder(page, '보관')
    await moveCurrentDocToFolder(page, '보관')

    await page.getByRole('button', { name: '새 문서' }).click()
    await expect(page.locator('.doc-title')).toBeVisible()
    expect((await readSavedContent(page)).content).toBe('')
    await expect(page.locator('.notice-message', { hasText: '새 문서 템플릿을 읽지 못해' })).toHaveCount(0)

    const dialog = await openEditorTab(page)
    const select = dialog.getByRole('combobox', { name: '새 문서 템플릿' })
    await expect(select).toHaveValue(`doc:${templateDocId}`)
    const missingOption = select.locator(`option[value="doc:${templateDocId}"]`)
    await expect(missingOption).toHaveText('찾을 수 없는 템플릿')
    await expect(missingOption).toBeDisabled()
    expect(await page.evaluate(() => localStorage.getItem('md.newDocTemplate'))).toBe(`doc:${templateDocId}`)
    await closeSettings(page)

    const templateItem = page.locator('.doc-item-btn', { hasText: '노트 틀' })
    if (!(await templateItem.isVisible())) await page.locator('.tree-row').filter({ hasText: '보관' }).first().click()
    await templateItem.click()
    await deleteCurrentDoc(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await expect(page.locator('.doc-title')).toBeVisible()
    expect((await readSavedContent(page)).content).toBe('')
    await expect(page.locator('.notice-message', { hasText: '새 문서 템플릿을 읽지 못해' })).toHaveCount(0)
  })
})

test.describe('F-2037 A13 서버 저장소', () => {
  test('생성 요청 1번에 템플릿 본문, 이어지는 PUT 없음', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await fakeServer(page)
    await setPrefBeforeLoad(page, 'md.newDocTemplate', 'builtin:daily')
    await openApp(page)

    const puts = []
    page.on('request', (req) => {
      if (req.method() === 'PUT' && /^\/api\/docs\/[^/]+$/.test(new URL(req.url()).pathname)) puts.push(req.url())
    })

    const reqPromise = page.waitForRequest((req) => req.method() === 'POST' && new URL(req.url()).pathname === '/api/docs')
    await page.getByRole('button', { name: '새 문서' }).click()
    const req = await reqPromise
    expect(req.postDataJSON().content).toBe(DAILY_CRLF)

    await waitSaved(page)
    await page.waitForTimeout(300)
    expect(puts).toEqual([])
  })
})
