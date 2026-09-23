// 상단바 서식 탭바 (specs/features/F-233.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, resizeWindow, setViewMode } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

async function mockPublicDoc(page) {
  await page.route('**/pub/docs/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ title: '공개 문서', content: '본문\n', lineEnding: 'lf', updatedAt: 1_700_000_000_000 }),
    }),
  )
}

test.describe('F-233 A1 표시 조건', () => {
  test('편집 모드에서 탭바가 보이고 기본 탭은 서식', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    await expect(page.locator('.editor-toolbar')).toBeVisible()
    await expect(page.getByRole('tab', { name: '서식' })).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('F-233 A2 명령 실행', () => {
  test('서식 탭 볼드체 — 선택을 **로 감싸고 포커스가 에디터로 돌아간다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '선택\n' })
    await page.locator('.cm-content .cm-line', { hasText: '선택' }).click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')

    await page.getByRole('button', { name: '볼드체' }).click()
    await expect(page.locator('.cm-line').first()).toHaveText('**선택**')

    const editorFocused = await page.evaluate(() => document.activeElement?.closest('.cm-content') != null)
    expect(editorFocused).toBe(true)
  })
})

test.describe('F-233 A3 탭 전환', () => {
  test('단락·삽입 탭을 누르면 아이콘 줄이 바뀐다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    await page.getByRole('tab', { name: '단락' }).click()
    await expect(page.getByRole('button', { name: '글머리 목록' })).toBeVisible()
    await expect(page.getByRole('button', { name: '볼드체' })).toHaveCount(0)

    await page.getByRole('tab', { name: '삽입' }).click()
    await expect(page.getByRole('button', { name: '표' })).toBeVisible()
    await expect(page.getByRole('button', { name: '글머리 목록' })).toHaveCount(0)
  })
})

test.describe('F-233 A4 제목 드롭다운', () => {
  test('제목 2 를 누르면 ## 이 붙고 목록이 닫힌다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    await page.getByRole('tab', { name: '단락' }).click()
    await page.locator('.cm-content .cm-line', { hasText: '내용' }).click()
    await page.keyboard.press('Home')

    const headingBtn = page.locator('.editor-toolbar').getByRole('button', { name: /^제목/ })
    await headingBtn.click()
    await page.getByRole('menuitem', { name: '제목 2' }).click()

    await expect(page.locator('.cm-line').first()).toHaveText('## 내용')
    await expect(page.locator('.editor-toolbar-heading .item-menu-list')).toBeHidden()
  })
})

test.describe('F-233 A5 숨김 조건', () => {
  test('보기 모드에서는 탭바가 안 보이고, 되돌리면 다시 보인다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    const toolbar = page.locator('.editor-toolbar')
    await expect(toolbar).toBeVisible()

    await setViewMode(page, 'view')
    await expect(toolbar).toHaveCount(0)
    await setViewMode(page, 'live')
    await expect(toolbar).toBeVisible()
  })

  test('좁은 창은 상단바 밑 자기 줄에 접히는 모양(--narrow)으로 보인다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    const toolbar = page.locator('.editor-toolbar')
    await expect(toolbar).toBeVisible()
    await expect(toolbar).not.toHaveClass(/editor-toolbar--narrow/)

    await resizeWindow(page, 900)
    await expect(toolbar).toBeVisible()
    await expect(toolbar).toHaveClass(/editor-toolbar--narrow/)
    await expect(page.locator('.editor-toolbar-row .editor-toolbar')).toHaveCount(1)
    await expect(page.locator('.topbar-spacer .editor-toolbar')).toHaveCount(0)

    await resizeWindow(page, 1280)
    await expect(toolbar).toBeVisible()
    await expect(toolbar).not.toHaveClass(/editor-toolbar--narrow/)
  })

  test('홈 화면(문서 미선택)에서는 탭바가 안 보인다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    await expect(page.locator('.editor-toolbar')).toBeVisible()
    await page.locator('[data-go-home]').click()
    await expect(page.locator('.editor-toolbar')).toHaveCount(0)
  })

  test('보기 권한만 있는(읽기 전용) 문서에서는 탭바가 안 보인다', async ({ page }) => {
    await fakeServer(page)
    const now = Date.now()
    await page.route(/\/api\/docs\/view-doc$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'view-doc',
          title: '보기 전용 문서',
          content: '원본 내용',
          lineEnding: 'lf',
          folderId: null,
          pinnedAt: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        }),
      })
    })
    await page.route('**/api/shared', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'view-doc',
            title: '보기 전용 문서',
            lineEnding: 'lf',
            folderId: null,
            pinnedAt: null,
            version: 1,
            createdAt: now,
            updatedAt: now,
            role: 'view',
            ownerEmail: 'owner@x.com',
          },
        ]),
      }),
    )

    await openApp(page)
    await page.getByText('보기 전용 문서').click()
    await expect(page.locator('.doc-title')).toHaveValue('보기 전용 문서')
    await expect(page.locator('.editor-toolbar')).toHaveCount(0)
  })
})

test.describe('F-233 A6 설정 토글', () => {
  test('탭바 를 숨김으로 바꾸면 즉시 사라진다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    await expect(page.locator('.editor-toolbar')).toBeVisible()

    await page.getByRole('button', { name: '설정', exact: true }).click()
    await page.locator('dialog[aria-labelledby="settings-title"]').getByRole('tab', { name: '편집기' }).click() // F-290 — 탭바는 편집기 탭
    await page.locator('#toolbar-label').locator('..').getByRole('radio', { name: '숨김' }).click()
    await page.getByRole('button', { name: '닫기', exact: true }).click()

    await expect(page.locator('.editor-toolbar')).toHaveCount(0)
  })
})

test.describe('F-233 A7 공개 화면 무관', () => {
  test('PublicView 설정 대화상자에는 탭바 항목이 없다', async ({ page }) => {
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-title')).toHaveText('공개 문서')

    await page.getByRole('button', { name: '설정', exact: true }).click()
    const dialog = page.locator('dialog[aria-labelledby="settings-title"]')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('#toolbar-label')).toHaveCount(0)
  })
})

test.describe('F-233 A8 접근성', () => {
  test('Tab·화살표·Enter·Esc 로 탭·아이콘·제목 드롭다운 전부 도달·조작 가능', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    const formatTab = page.getByRole('tab', { name: '서식' })
    const blockTab = page.getByRole('tab', { name: '단락' })
    await formatTab.focus()
    await page.keyboard.press('ArrowRight')
    await expect(blockTab).toBeFocused()
    await expect(blockTab).toHaveAttribute('aria-selected', 'true')

    const headingBtn = page.locator('.editor-toolbar').getByRole('button', { name: /^제목/ })
    await headingBtn.focus()
    await page.keyboard.press('Enter')
    const items = page.locator('.editor-toolbar-heading .item-menu-list [role="menuitem"]')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('.editor-toolbar-heading .item-menu-list')).toBeHidden()
    await expect(headingBtn).toBeFocused()
  })
})
