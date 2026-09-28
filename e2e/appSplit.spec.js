// App.tsx 분할 특성 테스트 — 옮기기 전 동작을 고정한다 (specs/features/F-2059.md 5.2)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setViewMode, readSavedContent, setPrefBeforeLoad } from './helpers.js'

const root = (page) => page.locator('.context-menu-root')

async function rightClick(page, locator, dx = 5) {
  const box = await locator.boundingBox()
  await page.mouse.click(box.x + dx, box.y + box.height / 2, { button: 'right' })
}

test.describe('F-2061 우클릭 메뉴 절', () => {
  test('F-2061 C1 창 크기 변경·편집 영역 스크롤로 메뉴가 닫힌다', async ({ page }) => {
    await openApp(page)
    const content = Array.from({ length: 80 }, (_, i) => `줄 ${i}`).join('\n') + '\n'
    await importMarkdown(page, { content })
    const line = page.locator('.cm-line').first()
    await line.click()

    await rightClick(page, line)
    await expect(root(page)).toBeVisible()
    const size = page.viewportSize()
    await page.setViewportSize({ width: size.width - 100, height: size.height })
    await expect(root(page)).toHaveCount(0)

    await rightClick(page, line)
    await expect(root(page)).toBeVisible()
    await page.locator('.cm-scroller').first().evaluate((el) => {
      el.scrollTop = el.scrollTop + 200
    })
    await expect(root(page)).toHaveCount(0)

    const saved = await readSavedContent(page)
    expect(saved.content).toBe(content)
  })

  test('F-2061 C2 모두 선택 — 편집 모드는 문서 전체, 보기 모드는 본문 전체', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: 'ab\ncd\n' })
    const line = page.locator('.cm-line').first()
    await line.click()
    await rightClick(page, line)
    await root(page).getByRole('menuitem', { name: /^모두 선택/ }).click()
    await expect(root(page)).toHaveCount(0)
    await page.keyboard.type('X')
    await expect.poll(async () => (await readSavedContent(page)).content).toBe('X')

    await importMarkdown(page, { name: 'view.md', content: 'ab\ncd\n' })
    await setViewMode(page, 'view')
    const body = page.locator('.viewer .markdown-body')
    await expect(body).toBeVisible()
    await rightClick(page, body)
    await root(page).getByRole('menuitem', { name: /^모두 선택/ }).click()
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    expect(selected).toContain('ab')
    expect(selected).toContain('cd')
  })

  test('F-2061 C3 복사 쓰기 거부 — error 알림, 잘라내기는 지우지 않는다', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.clipboard.writeText = () => Promise.reject(new DOMException('denied', 'NotAllowedError'))
    })
    await openApp(page)
    await importMarkdown(page, { content: 'hello world\n' })
    const line = page.locator('.cm-line').first()
    const notice = page.locator('.notice--error .notice-message')

    async function selectHello() {
      await line.click()
      await page.keyboard.press('Home')
      for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight')
    }

    await selectHello()
    await rightClick(page, line)
    await root(page).getByRole('menuitem', { name: /^복사/ }).click()
    await expect(notice).toHaveText('복사하지 못했습니다. 브라우저 권한을 확인하세요.')
    await expect(line).toHaveText('hello world')

    await page.getByRole('button', { name: '알림 닫기' }).click()
    await expect(notice).toHaveCount(0)
    await selectHello()
    await rightClick(page, line)
    await root(page).getByRole('menuitem', { name: /^잘라내기/ }).click()
    await expect(notice).toHaveText('복사하지 못했습니다. 브라우저 권한을 확인하세요.')
    await expect(line).toHaveText('hello world')
  })

  test('F-2061 C4 이미지만 든 클립보드 붙여넣기 — 편집 모드는 첨부로 넣는다', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.clipboard.read = async () => [
        {
          types: ['image/png'],
          getType: async () => {
            // 문맥이 없으면 convertToBlob 이 InvalidStateError 를 던진다
            const canvas = new OffscreenCanvas(40, 20)
            canvas.getContext('2d')
            return canvas.convertToBlob({ type: 'image/png' })
          },
        },
      ]
    })
    await openApp(page)
    await importMarkdown(page, { content: '\n' })
    const line = page.locator('.cm-line').first()
    await line.click()
    await rightClick(page, line)
    await root(page).getByRole('menuitem', { name: /^붙여넣기/ }).click()
    await expect.poll(async () => (await readSavedContent(page)).content).toMatch(/<img src="attachments\//)
  })
})

const PUBLIC_DOC = {
  title: '공개 문서',
  content: '# 제목1\n\n본문\n',
  lineEnding: 'lf',
  updatedAt: 1_700_000_000_000,
}

test.describe('F-2062 전역 단축키 절', () => {
  test('F-2062 C1 Ctrl+M 댓글창 여닫기', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.commentRail', 'closed')
    await openApp(page)
    await importMarkdown(page, { content: '첫 줄\n둘째 줄\n' })
    await page.locator('.cm-line').first().click()
    const rail = page.locator('.comment-rail')
    const toggle = page.locator('.comment-rail-toggle')
    const pref = () => page.evaluate(() => localStorage.getItem('md.commentRail'))

    await page.keyboard.press('Control+m')
    await expect(rail).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(pref).toBe('open')

    await page.locator('.cm-content').press('Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('.cm-content') != null)).toBe(true)

    await page.keyboard.press('Control+m')
    await expect(rail).toHaveCount(0)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(pref).toBe('closed')

    await page.getByRole('button', { name: '설정', exact: true }).click()
    const dialog = page.locator('dialog[open]')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Control+m')
    await expect(dialog).toBeVisible()
    await expect(rail).toHaveCount(0)
  })

  test('F-2062 C2 편집기 밖 Ctrl+F', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '찾을 글\n' })
    await page.evaluate(() => {
      document.activeElement?.blur()
      window.addEventListener('keydown', (e) => {
        if (e.key === 'f' || e.key === 'F') document.documentElement.dataset.findPrevented = String(e.defaultPrevented)
      })
    })
    await page.keyboard.press('Control+f')
    await expect(page.locator('.cm-search')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.dataset.findPrevented)).toBe('true')
  })

  test('F-2062 C3 공개 보기의 Ctrl+F·Ctrl+P', async ({ page }) => {
    await page.route('**/pub/docs/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PUBLIC_DOC) }),
    )
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-title')).toBeVisible()
    const results = await page.evaluate(() =>
      [
        { key: 'f', code: 'KeyF' },
        { key: 'p', code: 'KeyP' },
        { key: 'F', code: 'KeyF', shiftKey: true },
        { key: 'm', code: 'KeyM' },
      ].map((init) =>
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, ...init }),
        ),
      ),
    )
    expect(results).toEqual([true, true, true, true])
    await expect(page.locator('.cm-search')).toHaveCount(0)
  })
})

test.describe('F-2063 설정값·시스템 테마 절', () => {
  const SETTINGS = 'dialog[aria-labelledby="settings-title"]'

  async function openSettings(page, tab) {
    await page.getByRole('button', { name: '설정', exact: true }).click()
    const dialog = page.locator(SETTINGS)
    await expect(dialog).toBeVisible()
    if (tab) await dialog.getByRole('tab', { name: tab }).click()
    return dialog
  }

  const radio = (dialog, group, name) =>
    dialog.getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true })
  const htmlData = (page, key) => page.evaluate((k) => document.documentElement.dataset[k], key)
  const stored = (page, key) => page.evaluate((k) => window.localStorage.getItem(k), key)
  const twoFrames = (page) =>
    page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

  test('F-2063 C1 제목 서체 — 즉시 반영·저장·새로고침 유지', async ({ page }) => {
    await openApp(page)
    let dialog = await openSettings(page, '화면')
    await radio(dialog, '제목 서체', '산세리프').click()
    expect(await htmlData(page, 'headingFont')).toBe('sans')
    expect(await stored(page, 'md.headingFont')).toBe('sans')
    await dialog.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(dialog).toBeHidden()

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    dialog = await openSettings(page, '화면')
    await expect(radio(dialog, '제목 서체', '산세리프')).toHaveAttribute('aria-checked', 'true')
  })

  test('F-2063 C2 명시 테마는 시스템 변화를 따르지 않고, 시스템으로 되돌리면 다시 따른다', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await openApp(page)
    const dialog = await openSettings(page, '화면')
    await radio(dialog, '테마', '다크').click()
    expect(await htmlData(page, 'theme')).toBe('dark')
    expect(await stored(page, 'md.theme')).toBe('dark')

    await page.emulateMedia({ colorScheme: 'dark' })
    await page.emulateMedia({ colorScheme: 'light' })
    await twoFrames(page)
    expect(await htmlData(page, 'theme')).toBe('dark')

    await radio(dialog, '테마', '시스템').click()
    expect(await htmlData(page, 'theme')).toBe('white')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => htmlData(page, 'theme')).toBe('dark')
  })

  test('F-2063 C3 탭바 숨김 저장 — 새로고침 뒤에도 숨김', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '한 줄\n' })
    await expect(page.locator('.editor-toolbar')).toBeVisible()
    const dialog = await openSettings(page, '편집기')
    await radio(dialog, '탭바', '숨김').click()
    await dialog.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.editor-toolbar')).toHaveCount(0)
    expect(await stored(page, 'md.toolbar')).toBe('off')

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(page.locator('.editor-toolbar')).toHaveCount(0)
  })

  test('F-2063 C4 자동 잠금 선택 저장', async ({ page }) => {
    await openApp(page)
    let dialog = await openSettings(page, '금고')
    await radio(dialog, '자동 잠금', '15분').click()
    await expect(radio(dialog, '자동 잠금', '15분')).toHaveAttribute('aria-checked', 'true')
    expect(await stored(page, 'md.e2eeLockMinutes')).toBe('15')
    await dialog.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(dialog).toBeHidden()

    dialog = await openSettings(page, '금고')
    await expect(radio(dialog, '자동 잠금', '15분')).toHaveAttribute('aria-checked', 'true')
    await expect(radio(dialog, '자동 잠금', '30분')).toHaveAttribute('aria-checked', 'false')
  })

  test('F-2063 C5 시작 화면 선택 저장', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettings(page, '화면')
    await radio(dialog, '시작 화면', '홈').click()
    await expect(radio(dialog, '시작 화면', '홈')).toHaveAttribute('aria-checked', 'true')
    expect(await stored(page, 'md.startScreen')).toBe('home')
  })
})
