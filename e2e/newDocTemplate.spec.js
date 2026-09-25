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

test.describe('F-2037 A1 기본값', () => {
  test('none, 옵션 순서, 안내 문구', async ({ page }) => {
    await openApp(page)
    const dialog = await openEditorTab(page)
    const select = dialog.getByRole('combobox', { name: '새 문서 템플릿' })
    await expect(select).toHaveValue('none')
    await expect(select.locator('option')).toHaveText(['없음', '회의록', '일일 노트', '버그 보고', '주간 회고'])
    await expect(dialog.locator('.dialog-note')).toHaveText("최상위에 '템플릿' 폴더를 만들고 문서를 넣으면 여기에 함께 나옵니다.")
  })
})

test.describe('F-2037 A2 설정 저장', () => {
  test('고른 값이 저장되고 새로고침 뒤에도 유지', async ({ page }) => {
    await openApp(page)
    const dialog = await openEditorTab(page)
    await dialog.getByRole('combobox', { name: '새 문서 템플릿' }).selectOption({ label: '회의록' })
    await closeSettings(page)

    await page.reload()
    const dialog2 = await openEditorTab(page)
    await expect(dialog2.getByRole('combobox', { name: '새 문서 템플릿' })).toHaveValue('builtin:meeting')
    expect(await page.evaluate(() => localStorage.getItem('md.newDocTemplate'))).toBe('builtin:meeting')
  })
})

test.describe('F-2037 A3 사이드바 새 문서', () => {
  test('회의록 템플릿 — 저장 본문, 제목 포커스 + 전체 선택', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await setPrefBeforeLoad(page, 'md.newDocTemplate', 'builtin:meeting')
    await openApp(page)

    await page.getByRole('button', { name: '새 문서' }).click()
    await expect(page.locator('.doc-title')).toBeVisible()

    const saved = await readSavedContent(page)
    expect(saved.content).toBe(MEETING_CRLF)

    const titleInput = page.locator('.doc-title')
    await expect(titleInput).toBeFocused()
    await expect(titleInput).toHaveValue('제목 없는 문서')
    const sel = await titleInput.evaluate((el) => ({ start: el.selectionStart, end: el.selectionEnd, len: el.value.length }))
    expect(sel.start).toBe(0)
    expect(sel.end).toBe(sel.len)
  })
})

test.describe('F-2037 A4 폴더 메뉴 새 문서', () => {
  test('버그 보고 템플릿', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.newDocTemplate', 'builtin:bug')
    await openApp(page)
    await newTopFolder(page, '일반')
    await newDocInFolder(page, '일반')

    const saved = await readSavedContent(page)
    expect(saved.content).toBe(BUG_CRLF)
  })
})

test.describe('F-2037 A4 빈 화면 새 문서', () => {
  test('버그 보고 템플릿', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.newDocTemplate', 'builtin:bug')
    await openAppHome(page)
    await page.locator('.empty-state').getByRole('button', { name: '새 문서' }).click()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()

    const saved = await readSavedContent(page)
    expect(saved.content).toBe(BUG_CRLF)
  })
})

test.describe('F-2037 A5 없음 — 지금 그대로', () => {
  test('설정 없이 새 문서 — 빈 문서', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await expect(page.locator('.doc-title')).toBeVisible()

    const saved = await readSavedContent(page)
    expect(saved.content).toBe('')
  })
})

test.describe('F-2037 A6 사용자 템플릿 + 위키링크 제목', () => {
  test('링크 제목으로 {{title}} 치환', async ({ page }) => {
    await openApp(page)
    const containerDocId = await setupUserTemplate(page)
    await importMarkdown(page, { content: '[[새 링크]]\n\n본문\n' })
    await expect.poll(() => currentDocId(page)).not.toBe(containerDocId)

    await page.locator('.cm-content').getByText('본문', { exact: true }).click()
    await page.locator('.cm-content .md-wikilink').filter({ hasText: '새 링크' }).click()

    await expect(page.locator('.doc-title')).toHaveValue('새 링크')
    const saved = await readSavedContent(page)
    expect(saved.content).toBe('## 새 링크\r\n\r\n- ')
  })
})

test.describe('F-2037 A7 사용자 템플릿 + 새 문서 버튼', () => {
  test('{{title}} 은 빈 글자', async ({ page }) => {
    await openApp(page)
    await setupUserTemplate(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await expect(page.locator('.doc-title')).toBeVisible()

    const saved = await readSavedContent(page)
    expect(saved.content).toBe('## \r\n\r\n- ')
  })
})

test.describe('F-2037 A7b 팔레트는 그대로', () => {
  test('제목 없는 문서에 팔레트로 넣으면 F-2022 규칙(제목 없는 문서)', async ({ page }) => {
    await openApp(page)
    await setupUserTemplate(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await expect(page.locator('.doc-title')).toBeVisible()
    await page.locator('.doc-title').press('Escape').catch(() => {})

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Control+p')
    await page.keyboard.press('Enter')
    await palette(page).locator('.command-palette-input').fill('노트 틀')
    await page.keyboard.press('Enter')

    // 팔레트 삽입은 템플릿 문서를 비동기로 읽은 뒤라, 저장 표시가 먼저 '저장됨' 일 수 있다 — 저장값이 바뀔 때까지 기다린다
    await expect.poll(async () => (await readSavedContent(page)).content).toContain('## 제목 없는 문서')
  })
})

test.describe('F-2037 A8 되돌리기로 안 사라짐', () => {
  test('제목 Enter 뒤 Ctrl+Z — 템플릿이 남아 있다', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await setPrefBeforeLoad(page, 'md.newDocTemplate', 'builtin:meeting')
    await openApp(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await expect(page.locator('.doc-title')).toBeFocused()

    await page.locator('.doc-title').press('Enter')
    await page.keyboard.press('Control+z')

    const saved = await readSavedContent(page)
    expect(saved.content).toBe(MEETING_CRLF)
  })
})

test.describe('F-2037 A9 템플릿을 폴더 밖으로', () => {
  test('빈 문서, 알림 없음, 선택칸에 찾을 수 없는 템플릿, localStorage 는 그대로', async ({ page }) => {
    await openApp(page)
    const templateDocId = await setupUserTemplate(page)
    await newTopFolder(page, '보관')
    await moveCurrentDocToFolder(page, '보관')

    await page.getByRole('button', { name: '새 문서' }).click()
    await expect(page.locator('.doc-title')).toBeVisible()
    const saved = await readSavedContent(page)
    expect(saved.content).toBe('')
    await expect(page.locator('.notice-message', { hasText: '새 문서 템플릿을 읽지 못해' })).toHaveCount(0)

    const dialog = await openEditorTab(page)
    const select = dialog.getByRole('combobox', { name: '새 문서 템플릿' })
    await expect(select).toHaveValue(`doc:${templateDocId}`)
    const missingOption = select.locator(`option[value="doc:${templateDocId}"]`)
    await expect(missingOption).toHaveText('찾을 수 없는 템플릿')
    await expect(missingOption).toBeDisabled()
    expect(await page.evaluate(() => localStorage.getItem('md.newDocTemplate'))).toBe(`doc:${templateDocId}`)
  })
})

test.describe('F-2037 A10 템플릿 문서 삭제', () => {
  test('빈 문서, 알림 없음', async ({ page }) => {
    await openApp(page)
    await setupUserTemplate(page)
    await deleteCurrentDoc(page)

    await page.getByRole('button', { name: '새 문서' }).click()
    await expect(page.locator('.doc-title')).toBeVisible()
    const saved = await readSavedContent(page)
    expect(saved.content).toBe('')
    await expect(page.locator('.notice-message', { hasText: '새 문서 템플릿을 읽지 못해' })).toHaveCount(0)
  })
})

test.describe('F-2037 A11 읽기 실패', () => {
  test('IndexedDB 레코드가 지워진 템플릿 — 빈 문서 + error 알림', async ({ page }) => {
    await openApp(page)
    const templateDocId = await setupUserTemplate(page)

    // 편집기 메모리가 아니라 저장소에서 읽게 다른 문서로 옮긴다(4.2)
    await page.getByRole('button', { name: '새 문서' }).click()
    await expect.poll(() => currentDocId(page)).not.toBe(templateDocId)

    await deleteDocRecord(page, templateDocId)

    const before = await currentDocId(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await expect.poll(() => currentDocId(page)).not.toBe(before)

    const saved = await readSavedContent(page)
    expect(saved.content).toBe('')
    await expect(page.locator('.notice--error .notice-message')).toHaveText('새 문서 템플릿을 읽지 못해 빈 문서로 만들었습니다.')
  })
})

test.describe('F-2037 A12 가져오기는 템플릿을 넣지 않는다', () => {
  test('.md 가져오기 — 원문 그대로', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.newDocTemplate', 'builtin:meeting')
    await openApp(page)
    await importMarkdown(page, { content: '가져온 글\n' })

    const saved = await readSavedContent(page)
    expect(saved.content).toBe('가져온 글\n')
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

test.describe('F-2037 A14 팔레트 안내 줄 — 사용자 템플릿 없음', () => {
  test('폴더 규칙 + 변수 + 도움말 줄 셋', async ({ page }) => {
    await openApp(page)
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+p')
    await page.keyboard.press('Enter')

    const hint = palette(page).locator('.command-palette-hint')
    await expect(hint).toContainText("최상위에 '템플릿' 폴더를 만들고 문서를 넣으면 여기에 함께 나옵니다.")
    await expect(hint).toContainText('{{date}}·{{time}}·{{title}}은')
    await expect(hint).toContainText("도움말의 '템플릿' 절")
  })
})

test.describe('F-2037 A14 팔레트 안내 줄 — 사용자 템플릿 있음', () => {
  test('폴더 규칙 줄만 빠진다', async ({ page }) => {
    await openApp(page)
    await setupUserTemplate(page)
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+p')
    await page.keyboard.press('Enter')

    const hint = palette(page).locator('.command-palette-hint')
    await expect(hint).toHaveCount(1)
    await expect(hint).not.toContainText('폴더를 만들고')
    await expect(hint).toContainText('{{date}}·{{time}}·{{title}}은')
  })
})

test.describe('F-2037 A15 도움말', () => {
  test('템플릿 절이 있고 새 문서 템플릿 문구가 보인다', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '도움말' }).first().click()
    const helpPage = page.locator('.help-page')
    await expect(helpPage).toBeVisible()
    await expect(helpPage.getByRole('heading', { level: 2, name: '템플릿' })).toBeVisible()
    await expect(helpPage).toContainText('새 문서 템플릿')
  })
})
