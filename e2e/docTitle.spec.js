// 본문 맨 위 제목 (specs/features/F-217.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, setViewMode, openExportMenu } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

async function fillTitle(page, text) {
  await page.locator('.doc-title').fill(text)
}

test.describe('F-217 A1 원문 불변', () => {
  test('F-217 A1·A3 제목은 .md 내보내기·저장된 content 에 없고, 사이드바 동기·새로고침 유지·비우면 복귀', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: 'doc.md', content: '본문 첫 줄\n둘째 줄\n' })
    await fillTitle(page, '내 제목')
    await expect(page.locator('.tree-row').filter({ hasText: '내 제목' })).toHaveCount(1)
    await page.locator('.doc-title').blur()

    const saved = await readSavedContent(page)
    expect(saved.content).toBe('본문 첫 줄\n둘째 줄\n')
    expect(saved.content).not.toContain('내 제목')

    await openExportMenu(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: '.md', exact: true }).click(),
    ])
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString('utf-8')).toBe('본문 첫 줄\n둘째 줄\n')
    expect(download.suggestedFilename()).toBe('내 제목.md')

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(page.locator('.doc-title')).toHaveValue('내 제목')

    await fillTitle(page, '   ')
    await page.locator('.doc-title').blur()
    await expect(page.locator('.doc-title')).toHaveValue('제목 없는 문서')
  })
})

test.describe('F-217 A4 키보드', () => {
  test('F-217 A4·A5·A5b 제목 Enter·↑ 이동, 새 문서·폴더 메뉴 새 문서 뒤 제목에 포커스(전체 선택)', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문 내용\n' })

    await page.locator('.doc-title').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('맨앞')
    await expect(page.locator('.cm-content')).toContainText('맨앞본문 내용')

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('ArrowUp')
    await expect(page.locator('.doc-title')).toBeFocused()

    await page.getByRole('button', { name: '새 문서' }).click()
    await expect(page.locator('.doc-title')).toBeFocused()
    const selection = await page.locator('.doc-title').evaluate((el) => ({
      start: el.selectionStart,
      end: el.selectionEnd,
      value: el.value,
    }))
    expect(selection.start).toBe(0)
    expect(selection.end).toBe(selection.value.length)
    expect(selection.value.length).toBeGreaterThan(0)

    await page.locator('.sidebar').getByRole('button', { name: '새 폴더', exact: true }).click()
    const input = page.locator('.tree-rename-input')
    await input.fill('폴더A')
    await input.press('Enter')
    await page.locator('.tree-row').filter({ hasText: '폴더A' }).first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: '새 문서' }).click()
    await expect(page.locator('.doc-title')).toBeFocused()
    await page.getByRole('button', { name: '새 문서' }).click()
    await expect(page.locator('.doc-title')).toBeFocused()
  })
})

test.describe('F-217 A6 읽기 전용', () => {
  test('보기 권한만 있는 문서는 제목 입력이 막힌다', async ({ page }) => {
    await fakeServer(page)
    const now = Date.now()
    const shared = new Map([
      ['view-doc', { id: 'view-doc', title: '보기 전용 문서', content: '원본 내용', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now }],
    ])

    await page.route(/\/api\/docs\/view-doc$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shared.get('view-doc')) })
    })

    await page.route('**/api/shared', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'view-doc', title: '보기 전용 문서', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now, role: 'view', ownerEmail: 'owner@x.com' },
        ]),
      }),
    )

    await openApp(page)
    await page.getByText('보기 전용 문서').click()
    await expect(page.locator('.doc-title')).toHaveValue('보기 전용 문서')
    await expect(page.locator('.doc-title')).not.toBeEditable()
  })
})

// ----- F-234 제목 크기 축소, 폴더 경로 표시 -----

async function renameFolderRow(page, name) {
  await page.locator('.tree-rename-input').waitFor()
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
}

async function createTopFolder(page, name) {
  await page.getByRole('button', { name: '새 폴더', exact: true }).click()
  await renameFolderRow(page, name)
}

async function createSubfolder(page, parentName, name) {
  const row = page.locator('.tree-row').filter({ hasText: parentName }).first()
  await row.hover()
  await row.locator('.item-menu-btn').click()
  await page.getByRole('menuitem', { name: '하위 폴더' }).click()
  await renameFolderRow(page, name)
}

async function moveCurrentDocToFolder(page, folderName) {
  const docRow = page.locator('.tree-row').filter({ has: page.locator('.doc-item-btn[aria-current="page"]') })
  await docRow.hover()
  await docRow.locator('.item-menu-btn').click()
  await page.getByRole('menuitem', { name: '폴더로 이동…' }).click()
  const dialog = page.locator('.dialog[open]')
  await dialog.getByRole('radio', { name: folderName, exact: true }).click()
  await dialog.getByRole('button', { name: '이동', exact: true }).click()
}

// F-234 A1 제목 20px 고정은 시각 값이라 e2e 에서 뺐다 — specs/human-checks.md (2026-09-25 e2e 경량화)

test.describe('F-234 폴더 경로 표시', () => {
  test('A3·A5·A9·A6·A4·A7 폴더 이름, 클릭 이동(키보드 포함), 접힌 사이드바, 2단계, 이동 반영', async ({ page }) => {
    const highlightRow = () => page.locator('[data-folder-id] .tree-row').filter({ hasText: 'A' }).first()
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await createTopFolder(page, 'A')
    await createTopFolder(page, 'C')
    await createSubfolder(page, 'A', 'B')
    await moveCurrentDocToFolder(page, 'A')

    await expect(page.locator('.editor-slot .doc-title-crumb')).toHaveText('A')
    await expect(page.locator('.editor-slot .doc-title-crumb-sep')).toHaveCount(0)
    await setViewMode(page, 'raw')
    await expect(page.locator('.editor-slot .doc-title-crumb')).toHaveText('A')
    await setViewMode(page, 'view')
    await expect(page.locator('.viewer .doc-title-crumb')).toHaveText('A')
    await expect(page.locator('.viewer .doc-title-crumb-sep')).toHaveCount(0)
    await setViewMode(page, 'live')

    const crumb = page.locator('.doc-title-crumb')
    await crumb.click()
    await expect(highlightRow()).toBeVisible()
    await expect(highlightRow()).toHaveClass(/tree-row--highlight-(start|fading)/)

    await expect(crumb).toHaveAttribute('aria-label', 'A 폴더로 이동')
    await crumb.focus()
    await expect(crumb).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(highlightRow()).toHaveClass(/tree-row--highlight-(start|fading)/)

    await page.getByRole('button', { name: '사이드바 접기' }).click()
    await expect(page.locator('.sidebar')).toHaveClass(/sidebar--collapsed/)
    await crumb.click()
    await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--collapsed/)
    await expect(highlightRow()).toBeVisible()
    await expect(highlightRow()).toHaveClass(/tree-row--highlight-(start|fading)/)

    await moveCurrentDocToFolder(page, 'B')
    await expect(crumb).toHaveCount(2)
    await expect(crumb.nth(0)).toHaveText('A')
    await expect(crumb.nth(1)).toHaveText('B')
    await expect(page.locator('.doc-title-crumb-sep')).toHaveCount(1)

    await moveCurrentDocToFolder(page, 'C')
    await expect(crumb).toHaveText('C')
  })
})

// F-217 A7 좁은 창 긴 제목 가로 넘침은 e2e/dialogLayout.spec.js 의 합친 테스트로 옮겼다 (2026-09-25 e2e 경량화)
