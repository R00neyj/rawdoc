// 본문 맨 위 제목 (specs/features/F-217.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, resizeWindow, rectOf, setViewMode, openExportMenu } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

async function fillTitle(page, text) {
  await page.locator('.doc-title').fill(text)
}

test.describe('F-217 A1 원문 불변', () => {
  test('제목은 .md 내보내기·저장된 content 에 없다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: 'doc.md', content: '본문 첫 줄\n둘째 줄\n' })
    await fillTitle(page, '내 제목')
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
    const text = Buffer.concat(chunks).toString('utf-8')
    expect(text).toBe('본문 첫 줄\n둘째 줄\n')
    expect(download.suggestedFilename()).toBe('내 제목.md')
  })
})

test.describe('F-217 A2 자리', () => {
  test('상단바에 문서 제목 입력이 없고, 본문 맨 위에 제목이 있다 — 편집·원문·보기', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await fillTitle(page, '자리 확인')

    await expect(page.locator('.topbar .doc-title')).toHaveCount(0)
    await expect(page.locator('.cm-content .doc-title')).toHaveValue('자리 확인')

    const titleRect = await rectOf(page.locator('.doc-title'))
    const lineRect = await rectOf(page.locator('.cm-line').first())
    const linePadding = await page.locator('.cm-line').first().evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))
    // 제목 글자 시작 = 본문 첫 글자 시작 (.cm-line 패딩 안쪽, H77)
    expect(Math.abs(titleRect.left - (lineRect.left + linePadding))).toBeLessThanOrEqual(2)

    await setViewMode(page, 'raw')
    await expect(page.locator('.cm-content .doc-title')).toHaveValue('자리 확인')

    await setViewMode(page, 'view')
    await expect(page.locator('.doc-title-view')).toHaveText('자리 확인')
    await expect(page.locator('.topbar .doc-title')).toHaveCount(0)
  })
})

test.describe('F-217 A3 입력·저장', () => {
  test('입력하는 동안 사이드바가 함께 바뀌고, 새로고침 후 유지, 비우고 blur 하면 되돌아간다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await fillTitle(page, '수정된 제목')

    await expect(page.locator('.tree-row').filter({ hasText: '수정된 제목' })).toHaveCount(1)

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(page.locator('.doc-title')).toHaveValue('수정된 제목')

    await fillTitle(page, '   ')
    await page.locator('.doc-title').blur()
    await expect(page.locator('.doc-title')).toHaveValue('제목 없는 문서')
  })
})

test.describe('F-217 A4 키보드', () => {
  test('제목에서 Enter → 본문 맨 앞, 본문 첫 줄에서 ↑ → 제목', async ({ page }) => {
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
  })
})

test.describe('F-217 A5 새 문서', () => {
  test('새 문서 를 누르면 본문 제목에 포커스 + 전체 선택된다', async ({ page }) => {
    await openApp(page)
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

test.describe('F-234 A1 제목 크기', () => {
  test('20px 고정, 글자 크기 설정을 바꿔도 그대로', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await expect(page.locator('.doc-title')).toHaveCSS('font-size', '20px')

    await page.getByRole('button', { name: '설정', exact: true }).click()
    await page.locator('#font-size-label').locator('..').getByRole('radio', { name: '크게', exact: true }).click()
    await page.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(page.locator('.doc-title')).toHaveCSS('font-size', '20px')

    await setViewMode(page, 'view')
    await expect(page.locator('.doc-title-view')).toHaveCSS('font-size', '20px')
  })
})

test.describe('F-234 A2 폴더 밖', () => {
  test('편집·원문은 "제목" 표시, 보기는 경로 줄이 없다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })

    await expect(page.locator('.editor-slot .doc-title-label')).toHaveText('제목')
    await expect(page.locator('.editor-slot .doc-title-label')).toHaveAttribute('aria-hidden', 'true')
    await expect(page.locator('.editor-slot .doc-title-crumb')).toHaveCount(0)

    await setViewMode(page, 'raw')
    await expect(page.locator('.editor-slot .doc-title-label')).toHaveText('제목')

    await setViewMode(page, 'view')
    await expect(page.locator('.viewer .doc-title-label')).toHaveCount(0)
  })
})

test.describe('F-234 A3 폴더 안(1단계)', () => {
  test('편집·원문·보기 모두 폴더 이름, 구분자 없음', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await createTopFolder(page, 'A')
    await moveCurrentDocToFolder(page, 'A')

    await expect(page.locator('.editor-slot .doc-title-crumb')).toHaveCount(1)
    await expect(page.locator('.editor-slot .doc-title-crumb')).toHaveText('A')
    await expect(page.locator('.editor-slot .doc-title-crumb-sep')).toHaveCount(0)

    await setViewMode(page, 'raw')
    await expect(page.locator('.editor-slot .doc-title-crumb')).toHaveText('A')

    await setViewMode(page, 'view')
    await expect(page.locator('.viewer .doc-title-crumb')).toHaveText('A')
    await expect(page.locator('.viewer .doc-title-crumb-sep')).toHaveCount(0)
  })
})

test.describe('F-234 A4 폴더 안(2단계)', () => {
  test('"A / B" 로 보인다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await createTopFolder(page, 'A')
    await createSubfolder(page, 'A', 'B')
    await moveCurrentDocToFolder(page, 'B')

    await expect(page.locator('.doc-title-crumb')).toHaveCount(2)
    await expect(page.locator('.doc-title-crumb').nth(0)).toHaveText('A')
    await expect(page.locator('.doc-title-crumb').nth(1)).toHaveText('B')
    await expect(page.locator('.doc-title-crumb-sep')).toHaveCount(1)
  })
})

test.describe('F-234 A5 클릭 이동', () => {
  test('경로의 폴더 이름을 누르면 사이드바 행이 보이고 잠깐 강조된다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await createTopFolder(page, 'A')
    await moveCurrentDocToFolder(page, 'A')

    await page.locator('.doc-title-crumb').click()
    const folderRow = page.locator('[data-folder-id] .tree-row').filter({ hasText: 'A' }).first()
    await expect(folderRow).toBeVisible()
    await expect(folderRow).toHaveClass(/tree-row--highlight-(start|fading)/)
  })
})

test.describe('F-234 A6 접힌 사이드바', () => {
  test('레일 상태에서 경로를 누르면 사이드바가 펼쳐지고 행으로 스크롤·강조된다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await createTopFolder(page, 'A')
    await moveCurrentDocToFolder(page, 'A')

    await page.getByRole('button', { name: '사이드바 접기' }).click()
    await expect(page.locator('.sidebar')).toHaveClass(/sidebar--collapsed/)

    await page.locator('.doc-title-crumb').click()
    await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--collapsed/)
    const folderRow = page.locator('[data-folder-id] .tree-row').filter({ hasText: 'A' }).first()
    await expect(folderRow).toBeVisible()
    await expect(folderRow).toHaveClass(/tree-row--highlight-(start|fading)/)
  })
})

test.describe('F-234 A7 폴더 이동 반영', () => {
  test('문서를 다른 폴더로 옮기면 경로 표시가 바뀐다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await createTopFolder(page, 'A')
    await createTopFolder(page, 'C')
    await moveCurrentDocToFolder(page, 'A')
    await expect(page.locator('.doc-title-crumb')).toHaveText('A')

    await moveCurrentDocToFolder(page, 'C')
    await expect(page.locator('.doc-title-crumb')).toHaveText('C')
  })
})

test.describe('F-234 A8 공개·공유 화면 무관', () => {
  test('공개 보기 화면은 경로 표시가 없다', async ({ page }) => {
    await page.route('**/pub/docs/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ title: '공개 문서', content: '본문\n', lineEnding: 'lf', updatedAt: 1_700_000_000_000 }),
      }),
    )
    await page.goto('/#/p/tok123')
    await expect(page.locator('.viewer')).toBeVisible()
    await expect(page.locator('.doc-title-crumb')).toHaveCount(0)
    await expect(page.locator('.doc-title-label')).toHaveCount(0)
  })
})

test.describe('F-234 A9 접근성', () => {
  test('폴더 이름 버튼은 키보드로 닿고 Enter 로 동작한다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await createTopFolder(page, 'A')
    await moveCurrentDocToFolder(page, 'A')

    const crumb = page.locator('.doc-title-crumb')
    await expect(crumb).toHaveAttribute('aria-label', 'A 폴더로 이동')
    await crumb.focus()
    await expect(crumb).toBeFocused()
    await page.keyboard.press('Enter')

    const folderRow = page.locator('[data-folder-id] .tree-row').filter({ hasText: 'A' }).first()
    await expect(folderRow).toHaveClass(/tree-row--highlight-(start|fading)/)
  })
})

test.describe('F-217 A7 긴 제목', () => {
  test('좁은 창에서 긴 제목은 가로 스크롤 없이 여러 줄로 보인다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await resizeWindow(page, 400)
    const longTitle = '아주 아주 아주 아주 아주 아주 아주 아주 긴 제목이 줄바꿈 되는지 확인합니다'
    await fillTitle(page, longTitle)

    const scrollWidth = await page.evaluate(() => document.scrollingElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.scrollingElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)

    const box = await page.locator('.doc-title').evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    }))
    expect(box.scrollHeight).toBeGreaterThan(box.lineHeight * 1.5)
  })
})

// 폴더 메뉴 새 문서 뒤 최상위 새 문서에서 제목 포커스가 비던 버그 (2026-09-24, F-2022 구현 중 발견)
test.describe('F-217 A5b 폴더 메뉴 새 문서', () => {
  test('폴더 메뉴 새 문서·이어서 최상위 새 문서 모두 제목에 포커스된다', async ({ page }) => {
    await openApp(page)
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
