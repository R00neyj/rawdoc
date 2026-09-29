// App.tsx 분할 특성 테스트 — 옮기기 전 동작을 고정한다 (specs/features/F-2059.md 5.2)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setViewMode, readSavedContent, setPrefBeforeLoad, resizeWindow, currentDocId, waitSaved, openHelpFromSidebar } from './helpers.js'
import { zipSync, unzipSync } from 'fflate'
import { fakeServer } from './fixtures/fakeServer.js'
import { createFakeDocRoom } from './fixtures/fakeDocRoom.js'

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

// shares.spec.js 도우미와 같은 모양 — 그 파일은 F-243 소유라 import 하지 않는다 (F-2064 7.2)
function seedDoc(server, { id, title, folderId = null }) {
  const now = Date.now()
  server.docs.set(id, { id, title, content: '내용', lineEnding: 'lf', folderId, pinnedAt: null, version: 1, createdAt: now, updatedAt: now })
}

function seedFolder(server, { id, name, parentId = null }) {
  const now = Date.now()
  server.folders.set(id, { id, name, parentId, createdAt: now, updatedAt: now })
}

function seedLink(server, { targetType, targetId, token }) {
  server.shareLinks.set(`${targetType}:${targetId}`, { token, createdAt: Date.now(), revokedAt: null })
}

function seedGrant(server, { targetType, targetId, email, role }) {
  server.grants.set(`${targetType}:${targetId}:${email}`, { role, createdAt: Date.now() })
}

async function openShares(page) {
  await page.getByRole('button', { name: '계정' }).click()
  await page.getByRole('menuitem', { name: '공유 관리' }).click()
  await expect(page.locator('.shares-page-head h1')).toHaveText('공유 관리')
}

async function closeShares(page) {
  await page.locator('.shares-close').click()
  await expect(page.locator('.shares-page')).toHaveCount(0)
}

function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const isSharesList = (req) => req.method() === 'GET' && new URL(req.url()).pathname === '/api/shares'

test.describe('F-2064 공유 관리 절', () => {
  const rows = (page) => page.locator('.shares-link-row')
  const twoFrames = (page) =>
    page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

  test('F-2064 C2 다시 들어오면 새로 부른다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: '회의록' })
    seedLink(server, { targetType: 'doc', targetId: 'd1', token: 'tok-1' })
    await openApp(page)
    let listRequests = 0
    page.on('request', (req) => {
      if (isSharesList(req)) listRequests++
    })

    await openShares(page)
    await expect(rows(page)).toHaveCount(1)
    await closeShares(page)

    seedDoc(server, { id: 'd2', title: '기획서' })
    seedLink(server, { targetType: 'doc', targetId: 'd2', token: 'tok-2' })
    await openShares(page)
    await expect(rows(page)).toHaveCount(2)
    expect(listRequests).toBe(2)
  })

  test('F-2064 C3 목록 실패 — 빈 상태, 앞 목록을 지운다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: '회의록' })
    seedLink(server, { targetType: 'doc', targetId: 'd1', token: 'tok-doc' })
    await openApp(page)

    await openShares(page)
    await expect(rows(page)).toHaveCount(1)
    await closeShares(page)

    await page.route('**/api/shares', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server"}' }),
    )
    await openShares(page)
    await expect(page.locator('.shares-empty')).toHaveText('공유 중인 문서와 폴더가 없습니다.')
    await expect(rows(page)).toHaveCount(0)
  })

  test('F-2064 C4 로그인 상태로 #/shares 바로 열기', async ({ page }) => {
    const server = await fakeServer(page)
    seedFolder(server, { id: 'f1', name: '업무' })
    seedGrant(server, { targetType: 'folder', targetId: 'f1', email: 'a@b.com', role: 'edit' })

    await page.goto('/#/shares')
    await expect(page.locator('.shares-grant-row')).toHaveCount(1)
    await expect(page.locator('.shares-grant-row')).toContainText('업무')
  })

  test('F-2064 C5 떠난 뒤 온 옛 응답은 버린다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: '회의록' })
    seedLink(server, { targetType: 'doc', targetId: 'd1', token: 'tok-doc' })
    await openApp(page)
    const gates = [deferred(), deferred()]
    let arrived = 0
    await page.route('**/api/shares', async (route) => {
      const n = arrived++
      await gates[n].promise
      if (n === 0) return route.fallback()
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ links: [], grants: [] }) })
    })

    await openShares(page)
    await expect.poll(() => arrived).toBe(1)
    await closeShares(page)
    await openShares(page)
    await expect.poll(() => arrived).toBe(2)

    const first = page.waitForResponse((res) => isSharesList(res.request()))
    gates[0].resolve()
    const res = await first
    expect((await res.json()).links).toHaveLength(1)
    await twoFrames(page)
    await expect(page.locator('.shares-loading')).toBeVisible()
    await expect(rows(page)).toHaveCount(0)

    gates[1].resolve()
    await expect(page.locator('.shares-empty')).toHaveText('공유 중인 문서와 폴더가 없습니다.')
  })

  test('F-2064 C6 폴더 링크 해제', async ({ page }) => {
    const server = await fakeServer(page)
    seedFolder(server, { id: 'f1', name: '업무' })
    seedLink(server, { targetType: 'folder', targetId: 'f1', token: 'tok-folder' })
    await openApp(page)
    const deletes = []
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && /\/api\/(docs|folders)\/[^/]+\/link$/.test(new URL(req.url()).pathname)) deletes.push(req.url())
    })

    await openShares(page)
    await expect(rows(page)).toHaveCount(1)
    const revoke = page.waitForRequest((req) => req.method() === 'DELETE' && new URL(req.url()).pathname === '/api/folders/f1/link')
    await page.locator('.shares-link-revoke').click()
    await revoke
    await expect(rows(page)).toHaveCount(0)
    expect(deletes).toHaveLength(1)
  })

  test('F-2064 C7 해제 실패 — 줄이 남고 오류 알림', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: '회의록' })
    seedLink(server, { targetType: 'doc', targetId: 'd1', token: 'tok-doc' })
    await openApp(page)
    await page.route('**/api/docs/d1/link', (route) => {
      if (route.request().method() === 'DELETE') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server"}' })
      }
      return route.fallback()
    })

    await openShares(page)
    await expect(rows(page)).toHaveCount(1)
    await page.locator('.shares-link-revoke').click()
    await expect(page.locator('.notice-message')).toHaveText('공유를 해제하지 못했습니다.')
    await expect(rows(page)).toHaveCount(1)
  })

  test('F-2064 C8 로그인 버튼 — 돌아올 주소 #/shares', async ({ page }) => {
    await page.route('**/api/me', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }),
    )
    await page.route('**/api/login**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>login</title>' }),
    )

    await page.goto('/#/shares')
    await page.locator('.shares-page').getByRole('button', { name: '로그인' }).click()
    await expect(page).toHaveURL(/\/api\/login\?return=%23%2Fshares$/)
  })
})

// exportWorkspace.spec.js 의 createFolder 와 같은 절차
async function createFolder(page, name) {
  await page.getByRole('button', { name: '새 폴더', exact: true }).click()
  const renameInput = page.locator('.tree-rename-input')
  await expect(renameInput).toBeFocused()
  await renameInput.fill(name)
  await page.keyboard.press('Enter')
  return page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') }).first()
}

async function openFolderMenu(folderRow) {
  const menuBtn = folderRow.locator('.item-menu-btn')
  await menuBtn.focus()
  await menuBtn.click()
}

test.describe('F-2065 내보내기 구역', () => {
  test('F-2065 C1 오프라인에서 폴더 ⋯ 내보내기 두 개는 error 알림만 띄운다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    const server = await fakeServer(page)
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    const folderRow = await createFolder(page, '오프라인폴더')
    await expect(folderRow).toContainText('오프라인폴더')

    let downloads = 0
    page.on('download', () => {
      downloads++
    })
    server.setOffline(true)
    // setOffline 만으로는 syncState.online 이 false 가 되지 않는다 (F-281 A14 와 같은 이유)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))

    const errorMessage = page.locator('.notice--error .notice-message')
    await openFolderMenu(folderRow)
    await page.locator('.item-menu-list:not([inert])').getByRole('menuitem', { name: '폴더 내보내기' }).click()
    await expect(errorMessage).toHaveText('온라인일 때 내보낼 수 있습니다.')
    await page.getByRole('button', { name: '알림 닫기' }).click()
    // 오프라인 뒤 늦게 뜬 다른 알림이 자리를 채울 수 있다 — 개수 0 대신 이 문구가 사라졌는지만 본다
    await expect(errorMessage.filter({ hasText: '온라인일 때 내보낼 수 있습니다.' })).toHaveCount(0)

    await openFolderMenu(folderRow)
    await page.locator('.item-menu-list:not([inert])').getByRole('menuitem', { name: '옵시디언 볼트로 내보내기' }).click()
    await expect(errorMessage).toHaveText('온라인일 때 내보낼 수 있습니다.')
    expect(downloads).toBe(0)
  })
})

async function createLayoutFolder(page, name) {
  await page.locator('.sidebar-actions').getByRole('button', { name: '새 폴더', exact: true }).click()
  const input = page.locator('.tree-rename-input')
  await expect(input).toBeFocused()
  await input.fill(name)
  await input.press('Enter')
  await expect(input).toHaveCount(0)
  await expect(page.locator('.sidebar .tree-label').filter({ hasText: name })).toBeVisible()
}

async function moveDocToLayoutFolder(page, folderName) {
  const docRow = page.locator('.tree-row').filter({ has: page.locator('.doc-item-btn[aria-current="page"]') })
  await docRow.hover()
  await docRow.locator('.item-menu-btn').click()
  await page.getByRole('menuitem', { name: '폴더로 이동…' }).click()
  const dialog = page.locator('.dialog[open]')
  await dialog.getByRole('radio', { name: folderName, exact: true }).click()
  await dialog.getByRole('button', { name: '이동', exact: true }).click()
}

async function runPaletteCommand(page, query) {
  await page.keyboard.press('Control+p')
  await page.locator('.command-palette-input').fill(query)
  await page.keyboard.press('Enter')
}

const folderToggle = (page, label) => page.locator('.sidebar').getByRole('button', { name: label, exact: true })
const readPref = (page, key) => page.evaluate((k) => window.localStorage.getItem(k), key)
const readOpenFolders = (page) => page.evaluate(() => JSON.parse(window.localStorage.getItem('md.openFolders') ?? 'null'))

test.describe('F-2066 사이드바 레이아웃 절', () => {
  test('F-2066 C1 폴더 펼침 기록', async ({ page }) => {
    await openApp(page)
    await createLayoutFolder(page, '가')
    await createLayoutFolder(page, '나')
    await expect(folderToggle(page, '가 접기')).toBeVisible()
    await expect(folderToggle(page, '나 접기')).toBeVisible()

    const naId = await page
      .locator('li[data-folder-id]')
      .filter({ has: page.getByRole('button', { name: '나 접기', exact: true }) })
      .last()
      .getAttribute('data-folder-id')
    await folderToggle(page, '가 접기').click()
    await expect(folderToggle(page, '가 펼치기')).toBeVisible()
    await expect.poll(() => readOpenFolders(page)).toEqual([naId])

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(folderToggle(page, '가 펼치기')).toBeVisible()
    await expect(folderToggle(page, '나 접기')).toBeVisible()

    await page.locator('.sidebar').getByRole('button', { name: '모두 접기', exact: true }).click()
    await expect(folderToggle(page, '나 펼치기')).toBeVisible()
    await expect.poll(() => readOpenFolders(page)).toEqual([])

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(folderToggle(page, '가 펼치기')).toBeVisible()
    await expect(folderToggle(page, '나 펼치기')).toBeVisible()
  })

  test('F-2066 C2 좁은 창 문서 고르기·창 넓혔다 좁히기', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '첫째.md', content: '첫째\n' })
    await importMarkdown(page, { name: '둘째.md', content: '둘째\n' })
    await resizeWindow(page, 900)
    const sidebar = page.locator('.sidebar')
    await expect(sidebar).toBeHidden()

    await page.locator('.sidebar-toggle').click()
    await expect(sidebar).toBeVisible()
    const hashBefore = await page.evaluate(() => location.hash)
    await page.locator('.sidebar .doc-item-btn:not([aria-current="page"])').first().click()
    await expect(sidebar).toBeHidden()
    await expect.poll(() => page.evaluate(() => location.hash)).not.toBe(hashBefore)

    await page.locator('.sidebar-toggle').click()
    await expect(sidebar).toBeVisible()
    await resizeWindow(page, 1280)
    await expect(sidebar).toBeVisible()
    await expect(sidebar).not.toHaveClass(/sidebar--overlay/)

    await resizeWindow(page, 900)
    await expect(sidebar).toHaveClass(/sidebar--overlay/)
    await expect(sidebar).toBeHidden()
  })

  test('F-2066 C3 좁은 창 제목 경로 클릭', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await createLayoutFolder(page, '가')
    await moveDocToLayoutFolder(page, '가')
    await expect(page.locator('.doc-title-crumb')).toHaveText('가')
    await resizeWindow(page, 900)
    const sidebar = page.locator('.sidebar')
    await expect(sidebar).toBeHidden()

    await page.locator('.doc-title-crumb').click()
    await expect(sidebar).toBeVisible()
    const row = page.locator('[data-folder-id] .tree-row').filter({ hasText: '가' }).first()
    await expect(row).toBeVisible()
    await expect(row).toHaveClass(/tree-row--highlight-(start|fading)/)
  })

  test('F-2066 C4 팔레트 사이드바 명령', async ({ page }) => {
    await openApp(page)
    const sidebar = page.locator('.sidebar')
    await runPaletteCommand(page, '/사이드바 접기')
    await expect(sidebar).toHaveClass(/sidebar--collapsed/)
    await expect.poll(() => readPref(page, 'md.sidebar')).toBe('collapsed')

    await runPaletteCommand(page, '/사이드바 펴기')
    await expect(sidebar).not.toHaveClass(/sidebar--collapsed/)
    await expect.poll(() => readPref(page, 'md.sidebar')).toBe('expanded')

    await resizeWindow(page, 900)
    await expect(sidebar).toBeHidden()
    await runPaletteCommand(page, '/사이드바 열기')
    await expect(sidebar).toBeVisible()
    expect(await readPref(page, 'md.sidebar')).toBe('expanded')
  })
})

function itemButton2067(page, name) {
  const sidebar = page.locator('.sidebar')
  return sidebar.getByRole('button', { name, exact: true }).or(sidebar.getByRole('link', { name, exact: true }))
}

function treeRowOf2067(locator) {
  return locator.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " tree-row ")]')
}

function folderItem2067(page, name) {
  return page.locator('.tree-item[data-folder-id]').filter({ has: page.getByRole('button', { name, exact: true }) })
}

async function openRowMenu2067(page, name) {
  await page.locator('.sidebar').getByRole('button', { name: `${name} 메뉴` }).click()
  return page.locator('.item-menu-list:not([inert])')
}

async function importNamed2067(page, name) {
  return importMarkdown(page, { name: `${name}.md`, content: `${name}\n` })
}

test.describe('F-2067 삭제·폴더·고정·이동 절', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('F-2067 C1 지금 문서 삭제 — 남은 첫 문서로, 주소는 바꿔치기', async ({ page }) => {
    await openApp(page)
    await importNamed2067(page, '가')
    const naId = await importNamed2067(page, '나')
    const daId = await importNamed2067(page, '다')
    const historyLength = await page.evaluate(() => history.length)
    const confirmDialog = page.locator('dialog[open]')

    await (await openRowMenu2067(page, '가')).getByRole('menuitem', { name: '삭제' }).click()
    await confirmDialog.getByRole('button', { name: '삭제', exact: true }).click()
    await expect(itemButton2067(page, '가')).toHaveCount(0)
    expect(await currentDocId(page)).toBe(daId)
    expect(await page.evaluate(() => history.length)).toBe(historyLength)

    await (await openRowMenu2067(page, '다')).getByRole('menuitem', { name: '삭제' }).click()
    await confirmDialog.getByRole('button', { name: '삭제', exact: true }).click()
    await expect(itemButton2067(page, '다')).toHaveCount(0)
    await expect.poll(() => currentDocId(page)).toBe(naId)
    expect(await page.evaluate(() => window.localStorage.getItem('md.lastDocId'))).toBe(naId)
    expect(await page.evaluate(() => history.length)).toBe(historyLength)
  })

  test('F-2067 C2 여러 항목 삭제 — 열린 문서가 들어 있으면 홈', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    await importNamed2067(page, '가')
    await importNamed2067(page, '나')
    await importNamed2067(page, '다')
    await itemButton2067(page, '가').click()
    await itemButton2067(page, '나').click({ modifiers: ['Control'] })
    await treeRowOf2067(itemButton2067(page, '가')).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '삭제' }).click()

    const dialog = page.locator('dialog[aria-labelledby="confirm-bulk-delete-title"]')
    await expect(dialog).toContainText('2개')
    await dialog.getByRole('button', { name: '삭제', exact: true }).click()

    await expect(itemButton2067(page, '가')).toHaveCount(0)
    await expect(itemButton2067(page, '나')).toHaveCount(0)
    await expect(itemButton2067(page, '다')).toHaveCount(1)
    await expect(page.locator('.empty-state')).toBeVisible()
    expect(await currentDocId(page)).toBeNull()
    expect(await page.evaluate(() => location.hash)).toBe('#/')
    await expect(page.locator('.notice')).toHaveCount(0)
  })

  test('F-2067 C3 여러 항목 삭제 일부 실패 — 개수 알림, 나머지는 지워진다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    await createLayoutFolder(page, '갑')
    await createLayoutFolder(page, '을')
    await importNamed2067(page, '병')
    await itemButton2067(page, '갑').click({ modifiers: ['Control'] })
    await itemButton2067(page, '병').click({ modifiers: ['Control'] })
    await treeRowOf2067(itemButton2067(page, '병')).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '삭제' }).click()
    const dialog = page.locator('dialog[aria-labelledby="confirm-bulk-delete-title"]')
    await expect(dialog).toContainText('2개')

    const gapId = await folderItem2067(page, '갑').getAttribute('data-folder-id')
    await page.evaluate(
      (id) =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open('md-docs')
          req.onerror = () => reject(req.error)
          req.onsuccess = () => {
            const db = req.result
            const tx = db.transaction('folders', 'readwrite')
            tx.objectStore('folders').delete(id)
            tx.oncomplete = () => {
              db.close()
              resolve(null)
            }
            tx.onerror = () => reject(tx.error)
          }
        }),
      gapId,
    )
    await dialog.getByRole('button', { name: '삭제', exact: true }).click()

    await expect(page.locator('.notice-message')).toHaveText('1개를 삭제하지 못했습니다.')
    await expect(itemButton2067(page, '병')).toHaveCount(0)
    await expect(itemButton2067(page, '갑')).toHaveCount(0)
    await expect(itemButton2067(page, '을')).toHaveCount(1)
  })

  test('F-2067 C4 팔레트 고정·해제·폴더로 이동 — 접힌 폴더는 접힌 채', async ({ page }) => {
    await openApp(page)
    await createLayoutFolder(page, '가')
    const gaId = await page.locator('li[data-folder-id]').first().getAttribute('data-folder-id')
    await importNamed2067(page, '이동할 문서')
    await page.locator('.cm-content').click()

    await runPaletteCommand(page, '/이 문서 상단 고정')
    await expect(page.locator('.pinned-list .tree-row')).toHaveCount(1)
    await runPaletteCommand(page, '/이 문서 고정 해제')
    await expect(page.locator('.pinned-list')).toHaveCount(0)

    await folderToggle(page, '가 접기').click()
    await expect(folderToggle(page, '가 펼치기')).toBeVisible()
    await runPaletteCommand(page, '/이 문서 폴더로 이동…')
    const dialog = page.locator('.dialog[open]')
    await dialog.getByRole('radio', { name: '가', exact: true }).click()
    await dialog.getByRole('button', { name: '이동', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.doc-title-crumb')).toHaveText('가')
    await expect(folderToggle(page, '가 펼치기')).toBeVisible()
    expect(await readOpenFolders(page)).not.toContain(gaId)
  })

  test('F-2067 C5 좁은 창 삭제·이동 요청은 사이드바를 닫는다', async ({ page }) => {
    await openApp(page)
    await importNamed2067(page, '좁은 문서')
    await resizeWindow(page, 900)
    const sidebar = page.locator('.sidebar')
    await page.locator('.sidebar-toggle').click()
    await expect(sidebar).toBeVisible()

    await (await openRowMenu2067(page, '좁은 문서')).getByRole('menuitem', { name: '삭제' }).click()
    const deleteDialog = page.locator('dialog[open]')
    await expect(deleteDialog.getByRole('heading', { name: '문서 삭제' })).toBeVisible()
    await expect(sidebar).toHaveAttribute('data-state', 'closed')

    await deleteDialog.getByRole('button', { name: '취소', exact: true }).click()
    await page.locator('.sidebar-toggle').click()
    await expect(sidebar).toBeVisible()
    await (await openRowMenu2067(page, '좁은 문서')).getByRole('menuitem', { name: '폴더로 이동…' }).click()
    await expect(page.locator('dialog[open]')).toBeVisible()
    await expect(sidebar).toHaveAttribute('data-state', 'closed')
    await page.keyboard.press('Escape')
    await expect(page.locator('dialog[open]')).toHaveCount(0)
    await expect(itemButton2067(page, '좁은 문서')).toHaveCount(1)
  })
})

async function openSettingsData2068(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const dialog = page.locator('dialog[aria-labelledby="settings-title"]')
  await dialog.getByRole('tab', { name: '데이터' }).click()
  return dialog
}

async function chooseZip2068(page, buffer, name = 'import.zip') {
  const dialog = await openSettingsData2068(page)
  await dialog.getByRole('button', { name: '가져오기…', exact: true }).click()
  await page.locator('input[data-import="zip"]').setInputFiles({ name, mimeType: 'application/zip', buffer })
}

async function downloadBuffer2068(download) {
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

const importDialog2068 = (page) => page.locator('dialog[aria-labelledby="import-preview-title"]')
const exactLabel2068 = (page, name) => page.locator('.tree-label').filter({ hasText: new RegExp(`^${name}$`) })

function manifestZip2068(docs, files) {
  const manifest = { format: 1, exportedAt: Date.now(), scope: 'all', rootFolderId: null, folders: [], docs }
  return Buffer.from(zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)), ...files }))
}

function manifestDoc2068(id, name) {
  return { id, path: `${name}.md`, title: name, folderId: null, lineEnding: 'lf', createdAt: 1, updatedAt: 1, pinnedAt: null }
}

function vaultZip2068(files) {
  const entries = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new TextEncoder().encode(v)]))
  return Buffer.from(zipSync(entries))
}

test.describe('F-2068 가져오기·끌어놓기·이미지 절', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('F-2068 C1 zip 이 열린 문서를 갱신하면 편집기를 다시 마운트한다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    const docId = await importMarkdown(page, { name: 'doc.md', content: '원본 내용\n' })
    await page.locator('.doc-title').fill('갱신문서')
    await page.locator('.doc-title').blur()
    await waitSaved(page)

    const dialog = await openSettingsData2068(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: '전체 내보내기' }).click(),
    ])
    const zipBuffer = await downloadBuffer2068(download)
    await dialog.getByRole('button', { name: '닫기' }).click()

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('고친 내용')
    await waitSaved(page)

    const unzipped = unzipSync(new Uint8Array(zipBuffer))
    const manifest = JSON.parse(Buffer.from(unzipped['manifest.json']).toString('utf-8'))
    manifest.docs[0].updatedAt = Date.now() + 10_000_000
    const rezipped = zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
      [manifest.docs[0].path]: unzipped[manifest.docs[0].path],
    })
    await chooseZip2068(page, Buffer.from(rezipped))

    const importDialog = importDialog2068(page)
    await expect(importDialog).toContainText('갱신 1개')
    await importDialog.getByRole('button', { name: '가져오기' }).click()

    await expect(page.locator('.notice-message')).toHaveText('문서 0개를 가져오고 1개를 갱신했습니다.')
    await expect(page.locator('.cm-line').first()).toHaveText('원본 내용')
    expect(await currentDocId(page)).toBe(docId)
  })

  test('F-2068 C2 zip 일부·전부 실패 — 결과 대화상자와 알림', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    const bad = new Uint8Array([0x80, 0x81, 0x82])
    await chooseZip2068(
      page,
      manifestZip2068([manifestDoc2068('f2068-ok', '가'), manifestDoc2068('f2068-bad', '나')], {
        '가.md': new TextEncoder().encode('가 내용\n'),
        '나.md': bad,
      }),
    )
    const importDialog = importDialog2068(page)
    await expect(importDialog).toContainText('새로 2개')
    await importDialog.getByRole('button', { name: '가져오기' }).click()

    await expect(page.locator('.notice--warn .notice-message')).toHaveText('1개를 가져오지 못했습니다.')
    await expect(importDialog).toBeVisible()
    await expect(importDialog).toContainText('문서 1개를 가져왔습니다.')
    await expect(importDialog.locator('.import-list li')).toHaveText(['나 — 이 문서는 UTF-8 로 읽을 수 없어 가져오지 못했습니다'])
    await expect(exactLabel2068(page, '가')).toBeVisible()

    await importDialog.getByRole('button', { name: '닫기' }).click()
    await chooseZip2068(page, manifestZip2068([manifestDoc2068('f2068-bad2', '다')], { '다.md': bad }))
    await importDialog.getByRole('button', { name: '가져오기' }).click()

    await expect(page.locator('.notice--error .notice-message')).toHaveText('가져오지 못했습니다.')
    await expect(importDialog).toContainText('문서 0개를 가져왔습니다.')
    await expect(importDialog.locator('.import-list li')).toHaveCount(1)
    await importDialog.getByRole('button', { name: '닫기' }).click()
    await expect(importDialog).toBeHidden()
  })

  test('F-2068 C3 OS 파일 열기 — 부팅 뒤 소비자를 등록하고 새 문서로 가져온다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await page.addInitScript(() => {
      Object.defineProperty(window, 'launchQueue', {
        configurable: true,
        value: { consumer: null, setConsumer(c) { this.consumer = c } },
      })
    })
    await openApp(page)
    const before = await page.locator('.tree-row').count()
    await expect.poll(() => page.evaluate(() => window.launchQueue.consumer !== null)).toBe(true)
    await page.evaluate(() => {
      const handle = (n) => ({
        kind: 'file',
        name: `실행${n}.md`,
        getFile: async () => new File([`# 실행${n}\n`], `실행${n}.md`, { type: 'text/markdown' }),
      })
      window.launchQueue.consumer({ files: [handle(1), handle(2)] })
    })

    await expect(page.locator('.tree-row')).toHaveCount(before + 2)
    await expect(exactLabel2068(page, '실행1')).toBeVisible()
    await expect(exactLabel2068(page, '실행2')).toBeVisible()
    await expect(page.locator('.notice-message')).toHaveText('"실행2.md" 을(를) 가져왔습니다.')
    await expect(page.locator('.notice--error')).toHaveCount(0)
    const saved = await readSavedContent(page)
    expect(saved.content).toBe('# 실행2\n')
  })

  test('F-2068 C4 볼트 zip 이 열린 문서를 갱신하면 편집기를 다시 마운트하고 넣을 폴더를 편다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    await chooseZip2068(page, vaultZip2068({ '볼트/색인.md': '색인\n' }), 'vault.zip')
    const importDialog = importDialog2068(page)
    await expect(importDialog).toContainText('새로 1개')
    await importDialog.getByRole('button', { name: '가져오기' }).click()
    await expect(page.locator('.notice-message')).toHaveText('문서 1개를 가져왔습니다.')

    await exactLabel2068(page, '색인').click()
    await expect(page.locator('.cm-line').first()).toHaveText('색인')
    await page
      .locator('.tree-row')
      .filter({ has: page.locator('.tree-toggle') })
      .filter({ has: exactLabel2068(page, '볼트') })
      .locator('.tree-toggle')
      .click()
    await expect(exactLabel2068(page, '색인')).toBeHidden()

    await chooseZip2068(page, vaultZip2068({ '볼트/색인.md': '색인 고침\n' }), 'vault.zip')
    await expect(importDialog.locator('.import-target option:checked')).toHaveText('볼트')
    await expect(importDialog).toContainText('갱신 1개')
    await importDialog.getByRole('button', { name: '가져오기' }).click()

    await expect(page.locator('.notice-message')).toHaveText('문서 0개를 가져오고 1개를 갱신했습니다.')
    await expect(page.locator('.cm-line').first()).toHaveText('색인 고침')
    await expect(exactLabel2068(page, '색인')).toBeVisible()
  })
})

const GLUE_USER = { id: 'u1', email: 'a@b.com' }
const GLUE_CONTENT = '첫째 줄\n둘째 줄\n셋째 줄 고양이\n넷째 줄\n'

function glueNotif(overrides) {
  return {
    id: 'n',
    kind: 'mention',
    docId: 'notif-doc-1',
    commentId: 't1',
    threadId: 't1',
    actorEmail: 'x@y.com',
    docTitle: '문서',
    excerpt: '발췌',
    createdAt: Date.now(),
    readAt: null,
    ...overrides,
  }
}

function glueServerDoc(id, { title, content, updatedAt = Date.now() }) {
  return { id, title, content, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: updatedAt, updatedAt }
}

async function openGlueServerDoc(page, room, docs, hash, beforeGoto) {
  const server = await fakeServer(page, GLUE_USER)
  await room.install(page.context(), GLUE_USER)
  for (const d of docs) server.docs.set(d.id, glueServerDoc(d.id, d))
  await beforeGoto(server)
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await page.goto(`/${hash}`)
  await expect(page.locator('.cm-content').first()).not.toHaveText('', { timeout: 10_000 })
  return server
}

test.describe('F-2069 알림함 절', () => {
  test('F-2069 C1 계정이 빠지면 알림함이 닫히고, 돌아와도 닫힌 채', async ({ page }) => {
    const server = await fakeServer(page, GLUE_USER)
    server.setNotifications([glueNotif({ id: 'n1' })])
    await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)

    await page.locator('.notifications-btn').click()
    await expect(page.locator('.notifications-panel')).toBeVisible()

    const handler = (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' })
    await page.route('**/api/me', handler)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(page.locator('.notifications-btn')).toHaveCount(0)

    await page.unroute('**/api/me', handler)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(page.locator('.notifications-btn')).toBeVisible()
    await expect(page.locator('.notifications-panel')).toHaveCount(0)
  })

  test('F-2069 C2 목록에 있는 문서의 알림 — 목록을 다시 읽지 않는다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed('notif-doc-1', { content: GLUE_CONTENT, title: '함께 쓰는 문서' })
    room.seed('notif-doc-2', { content: '다른 문서 본문\n', title: '다른 문서' })
    const cat = GLUE_CONTENT.indexOf('고양이')
    room.putComment('notif-doc-1', 't1', { from: cat, to: cat + 3, body: '서버 댓글' })

    const server = await openGlueServerDoc(
      page,
      room,
      [
        { id: 'notif-doc-1', title: '함께 쓰는 문서', content: GLUE_CONTENT },
        { id: 'notif-doc-2', title: '다른 문서', content: '다른 문서 본문\n' },
      ],
      '#/d/notif-doc-2',
      (s) => s.setNotifications([glueNotif({ id: 'n1', docId: 'notif-doc-1', threadId: 't1' })]),
    )
    await expect(page.locator('.notifications-badge')).toHaveText('1')
    const countDocs = () => server.readRequests().filter((r) => r.path === '/api/docs').length
    const before = countDocs()

    await page.locator('.notifications-btn').click()
    await page.locator('.notification-item').first().click()

    await expect(page).toHaveURL(/#\/d\/notif-doc-1$/)
    await expect(page.locator('.comment-thread[data-thread-id="t1"]')).toHaveAttribute('data-active', 'true')
    expect(countDocs()).toBe(before)
  })
})

// ----- F-2070 실시간 알림 띠 절 -----
function serverDoc2070(id, { title, content }) {
  const now = Date.now()
  return { id, title, content, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now }
}

async function openLive2070(page, room, docs, openId) {
  const server = await fakeServer(page)
  await page.route(/\/api\/docs\/[^/]+\/lock(\?.*)?$/, (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ expiresAt: Date.now() + 60_000 }) })
    }
    return route.fulfill({ status: 204 })
  })
  await room.install(page.context())
  for (const doc of docs) server.docs.set(doc.id, serverDoc2070(doc.id, doc))
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await page.goto(`/#/d/${openId}`)
}

async function openViewLive2070(page, room) {
  await fakeServer(page)
  await room.install(page.context())
  // 서버 본문을 방과 다르게 둬서 방 본문이 보이면 실시간 동기화가 끝난 것으로 본다
  const viewDoc = serverDoc2070('f2070-view', { title: '보기 문서', content: '서버 본문' })
  await page.route(/\/api\/docs\/f2070-view$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewDoc) })
  })
  await page.route('**/api/shared', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ ...viewDoc, content: undefined, role: 'view', ownerEmail: 'owner@x.com' }]),
    }),
  )
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await page.goto('/#/d/f2070-view')
}

test.describe('F-2070 실시간 알림 띠 절', () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  test('F-2070 C1 동기화 뒤 4401 — N4 와 새 문서로 저장', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed('f2070-live', { content: '본문 가', title: '실시간 가' })
    await openLive2070(page, room, [{ id: 'f2070-live', title: '실시간 가', content: '본문 가' }], 'f2070-live')
    await expect(page.locator('.cm-content').first()).toContainText('본문 가')

    room.closeAll('f2070-live', 4401, 'unauthenticated')
    await expect(page.locator('.notice--error .notice-message')).toHaveText(
      '로그인이 만료되어 실시간 편집을 멈췄습니다. 지금 화면의 내용은 새 문서로 저장할 수 있습니다.',
    )
    await expect(page.locator('.notice').getByRole('button', { name: '새 문서로 저장' })).toBeVisible()
    await expect(page.locator('.cm-content').first()).toHaveAttribute('contenteditable', 'false')
  })

  test('F-2059 D1 지도 위에서 새 문서로 저장 — 지도를 떠나 새 문서를 연다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed('f2070-live', { content: '본문 가', title: '실시간 가' })
    await openLive2070(page, room, [{ id: 'f2070-live', title: '실시간 가', content: '본문 가' }], 'f2070-live')
    await expect(page.locator('.cm-content').first()).toContainText('본문 가')

    room.closeAll('f2070-live', 4401, 'unauthenticated')
    const saveBtn = page.locator('.notice').getByRole('button', { name: '새 문서로 저장' })
    await expect(saveBtn).toBeVisible()
    await page.getByRole('button', { name: '지도' }).first().click()
    await expect(page.locator('.map-page')).toBeVisible()

    await saveBtn.click()
    await expect(page).toHaveURL(/#\/d\/(?!f2070-live)[^/]+$/)
    await expect(page.locator('.map-page')).toHaveCount(0)
    await expect(page.locator('.cm-content').first()).toContainText('본문 가')
  })

  test('F-2070 C2 새 문서로 저장 알림은 다른 문서로 옮기면 걷힌다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed('f2070-live', { content: '본문 가', title: '실시간 가' })
    room.seed('f2070-other', { content: '본문 나', title: '실시간 나' })
    const docs = [
      { id: 'f2070-live', title: '실시간 가', content: '본문 가' },
      { id: 'f2070-other', title: '실시간 나', content: '본문 나' },
    ]
    await openLive2070(page, room, docs, 'f2070-live')
    await expect(page.locator('.cm-content').first()).toContainText('본문 가')

    room.closeAll('f2070-live', 4403, 'revoked')
    await expect(page.locator('.notice-message')).toHaveText('편집 권한이 없어져 읽기만 할 수 있습니다.')
    await page.locator('.doc-item-btn', { hasText: '실시간 나' }).click()

    await expect(page.locator('.cm-content').first()).toContainText('본문 나')
    await expect(page.getByText('편집 권한이 없어져 읽기만 할 수 있습니다.')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '새 문서로 저장' })).toHaveCount(0)
  })

  test('F-2070 C3 읽기 전용 세션 동기화 뒤 4401 — N10, 버튼 없음', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed('f2070-view', { content: '보기 본문', title: '보기 문서' })
    room.setRole('f2070-view', 'u1', 'view')
    await openViewLive2070(page, room)
    await expect(page.locator('.statusbar-save')).toHaveText('저장됨')
    // 저장됨 은 HTTP 본문으로도 뜬다 — 방 본문이 보여야 닫을 실시간 연결이 있다
    await expect(page.locator('.cm-content', { hasText: '보기 본문' })).toBeVisible()

    room.closeAll('f2070-view', 4401, 'unauthenticated')
    await expect(page.locator('.notice--error .notice-message')).toHaveText('로그인이 만료되어 실시간 연결을 멈췄습니다.')
    await expect(page.getByRole('button', { name: '새 문서로 저장' })).toHaveCount(0)
  })
})

test.describe('F-2071 해시 라우팅 절', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('F-2071 C1 도움말 — 뒤로 가기로 문서, 앞으로 가기로 다시 도움말', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    const A = await importMarkdown(page, { name: '가.md', content: '가 본문\n' })
    await openHelpFromSidebar(page)
    await expect(page.locator('.help-page')).toBeVisible()
    await expect(page).toHaveURL(/#\/help$/)

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`#/d/${A}$`))
    await expect(page.locator('.help-page')).toHaveCount(0)
    await expect(page.locator('.doc-title')).toHaveValue('가')

    await page.goForward()
    await expect(page.locator('.help-page')).toBeVisible()
    await expect(page).toHaveURL(/#\/help$/)

    await page.goBack()
    await expect(page.locator('.doc-title')).toHaveValue('가')
    await expect(page.locator('.help-page')).toHaveCount(0)
  })

  test('F-2071 C2 지도 — 앞으로 가기로 다시 들어가면 그 문서가 중심이다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    const A = await currentDocId(page)
    await page.locator('.sidebar').getByRole('button', { name: '지도' }).first().click()
    await expect(page.locator('.map-page')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`#/map/${A}$`))
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`#/d/${A}$`))
    await expect(page.locator('.map-page')).toHaveCount(0)

    await page.goForward()
    await expect(page.locator('.map-page')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`#/map/${A}$`))
    expect(await readPref(page, 'md.lastDocId')).toBe(A)

    await page.locator('.map-page').getByRole('button', { name: '닫기', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`#/d/${A}$`))
    await expect(page.locator('.map-page')).toHaveCount(0)
  })

  test('F-2071 C3 주소 직접 수정 — 폴더 안 문서는 폴더를 펴고 편집기에 초점, #/ 는 홈', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    const A = await importMarkdown(page, { name: '가.md', content: '가 본문\n' })
    await createLayoutFolder(page, '폴더')
    await moveDocToLayoutFolder(page, '폴더')
    await importMarkdown(page, { name: '나.md', content: '나 본문\n' })
    await folderToggle(page, '폴더 접기').click()
    await expect(folderToggle(page, '폴더 펼치기')).toBeVisible()

    await page.evaluate((id) => { location.hash = '#/d/' + id }, A)
    await expect(page.locator('.doc-title')).toHaveValue('가')
    await expect(folderToggle(page, '폴더 접기')).toBeVisible()
    await expect.poll(() => readPref(page, 'md.lastDocId')).toBe(A)
    await expect(page.locator('.cm-content')).toBeFocused()

    await page.evaluate(() => { location.hash = '#/' })
    await expect(page.locator('.empty-state')).toBeVisible()
    await expect(page).toHaveURL(/#\/$/)
  })
})

function docItem2072(page, name) {
  const sidebar = page.locator('.sidebar')
  return sidebar.getByRole('button', { name, exact: true }).or(sidebar.getByRole('link', { name, exact: true }))
}

test.describe('F-2072 편집기 연동 절', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('F-2072 C1 문서를 열면 상태바 글자·단어 수가 그 문서 저장 본문 기준이다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    const A = await importMarkdown(page, { name: '셈가.md', content: '하나 둘 셋\n' })
    await importMarkdown(page, { name: '셈나.md', content: 'abc def ghij klm\n' })
    await expect(page.locator('.statusbar-info')).toContainText('16자 · 4단어')

    await docItem2072(page, '셈가').click()
    await expect.poll(() => currentDocId(page)).toBe(A)
    await expect(page.locator('.statusbar-info')).toContainText('6자 · 3단어')

    await docItem2072(page, '셈나').click()
    await expect(page.locator('.statusbar-info')).toContainText('16자 · 4단어')
  })

  test('F-2072 C2 보기 모드에서 [[문서#제목]] 로 다른 문서를 열면 그 문서 HTML 이 그려진 뒤 제목으로 스크롤한다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    const LONG = Array.from({ length: 60 }, (_, i) => `문단 ${i}`).join('\n\n')
    const target = await importMarkdown(page, { name: '회의록.md', content: '회의 첫 줄\n\n' + LONG + '\n\n## 결정\n\n결정 내용\n' })
    await importMarkdown(page, { name: '출발.md', content: '출발 문서\n\n[[회의록#결정]]\n' })
    await setViewMode(page, 'view')
    const link = page.locator('.viewer a.wikilink[data-wikilink="회의록"][data-wikilink-heading="결정"]')
    await expect(link).toBeVisible()
    await link.click()

    await expect.poll(() => currentDocId(page)).toBe(target)
    await expect(page.locator('.viewer h2', { hasText: '결정' })).toBeInViewport()
    await expect(page.locator('.viewer p', { hasText: /^회의 첫 줄$/ })).not.toBeInViewport()
  })
})

const PASSWORD2073 = '충분히긴금고암호입니다'

async function waitBooted2073(page) {
  await expect(page.locator('.cm-host .cm-editor').or(page.locator('.e2ee-locked-panel')).or(page.locator('.empty-state'))).toBeVisible()
}

async function createVault2073(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const dialog = page.locator('dialog[aria-labelledby="settings-title"]')
  await dialog.getByRole('tab', { name: '금고' }).click()
  await dialog.getByRole('button', { name: '금고 만들기…' }).click()
  const create = page.locator('dialog[aria-labelledby="e2ee-create-title"]')
  await create.locator('input[aria-labelledby="e2ee-create-password-label"]').fill(PASSWORD2073)
  await create.locator('input[aria-labelledby="e2ee-create-confirm-label"]').fill(PASSWORD2073)
  await create.getByRole('button', { name: '다음' }).click()
  await create.getByLabel('복구 코드를 안전한 곳에 보관했습니다').check()
  await create.getByRole('button', { name: '금고 만들기' }).click()
  await expect(create).toBeHidden()
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.statusbar-e2ee')).toHaveText('금고 열림')
}

function rowOf2073(page, name) {
  const label = page.getByRole('button', { name, exact: true }).or(page.getByRole('link', { name, exact: true }))
  return page.locator('.sidebar .tree-row').filter({ has: label })
}

async function openRowMenu2073(page, name) {
  const row = rowOf2073(page, name)
  await row.hover()
  await row.getByRole('button', { name: `${name} 메뉴` }).click()
  return page.locator('.item-menu-list:not([inert])')
}

async function newFolder2073(page, name) {
  await page.locator('.sidebar').getByRole('button', { name: '새 폴더', exact: true }).click()
  const input = page.locator('.tree-rename-input')
  await expect(input).toBeFocused()
  await input.fill(name)
  await input.press('Enter')
  await expect(rowOf2073(page, name)).toBeVisible()
}

async function clickNewDocInFolder2073(page, folderName) {
  const menu = await openRowMenu2073(page, folderName)
  await menu.getByRole('menuitem', { name: '새 문서', exact: true }).click()
}

async function markLocalFolderE2ee2073(page, folderId) {
  await page.evaluate(
    (folderId) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('folders', 'readwrite')
          const store = tx.objectStore('folders')
          const get = store.get(folderId)
          get.onsuccess = () => store.put({ ...get.result, e2ee: true })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    folderId,
  )
}

async function folderIdOf2073(page, name) {
  return page.locator('.sidebar li[data-folder-id]').filter({ has: page.getByRole('button', { name, exact: true }) }).first().getAttribute('data-folder-id')
}

async function unlockVia2073(container) {
  await container.locator('input[type="password"]').fill(PASSWORD2073)
  await container.getByRole('button', { name: '열기', exact: true }).click()
}

// 로컬 금고 문서 하나를 만들어 제목·본문을 저장해 둔다 (e2eeDocs.spec.js makeLocalVaultDoc 와 같은 절차)
async function makeLocalVaultDoc2073(page) {
  await openApp(page)
  await createVault2073(page)
  await newFolder2073(page, '비밀함')
  const folderId = await folderIdOf2073(page, '비밀함')
  await markLocalFolderE2ee2073(page, folderId)
  await page.reload()
  await waitBooted2073(page)
  await clickNewDocInFolder2073(page, '비밀함')
  const unlock = page.locator('dialog[aria-labelledby="e2ee-unlock-title"]')
  await unlockVia2073(unlock)
  await expect(unlock).toBeHidden()
  await expect(page.locator('.doc-title')).toBeFocused()
  const docId = await currentDocId(page)
  await page.locator('.doc-title').fill('비밀 제목')
  await page.locator('.doc-title').press('Enter')
  await page.locator('.cm-content').click()
  await page.keyboard.type('비밀 본문 한 줄')
  await expect(page.locator('.statusbar-save')).toContainText('저장됨')
  return { folderId, docId }
}

test.describe('F-2073 금고 옮기기·이관·잠그기·초기화 절', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('F-2073 C1 잠가서 P1 이 뜬 문서는 초점을 주지 않고, 다른 문서에 다녀오면 P1 이 초점을 받는다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    const { docId: vaultId } = await makeLocalVaultDoc2073(page)
    // 가져오기는 지금 문서의 폴더에 넣는다 — 금고 폴더 밖 문서로 옮겨 가서 가져온다
    await page.locator('.sidebar .tree-row').filter({ has: page.getByRole('link', { name: '제목 없는 문서', exact: true }) }).getByRole('link').click()
    await expect.poll(() => currentDocId(page)).not.toBe(vaultId)
    const plainId = await importMarkdown(page, { name: '일반.md', content: '# 일반\n' })

    await page.locator(`.sidebar a[href="#/d/${vaultId}"]`).click()
    await expect(page.locator('.cm-content')).toContainText('비밀 본문 한 줄')
    await page.locator('.cm-content').click()
    await page.locator('.statusbar-e2ee').click()
    const panel = page.locator('.e2ee-locked-panel')
    await expect(panel).toBeVisible()
    await expect(page.locator('.cm-host .cm-editor')).toHaveCount(0)
    await expect(panel.locator('input[type="password"]')).not.toBeFocused()

    await page.locator(`.sidebar a[href="#/d/${plainId}"]`).click()
    await expect(page.locator('.cm-content')).toContainText('일반')
    await page.locator(`.sidebar a[href="#/d/${vaultId}"]`).click()
    await expect(panel).toBeVisible()
    await expect(panel.locator('input[type="password"]')).toBeFocused()
  })

  test('F-2073 C2 열린 금고 문서가 있을 때 금고를 초기화하면 문서를 닫고 주소가 #/ 가 된다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    const { folderId, docId } = await makeLocalVaultDoc2073(page)
    await expect.poll(() => currentDocId(page)).toBe(docId)

    await page.getByRole('button', { name: '설정', exact: true }).click()
    const settings = page.locator('dialog[aria-labelledby="settings-title"]')
    await settings.getByRole('tab', { name: '금고' }).click()
    await settings.getByRole('button', { name: '금고 초기화…' }).click()
    const reset = page.locator('dialog[aria-labelledby="e2ee-reset-title"]')
    await reset.locator('input[aria-labelledby="e2ee-reset-confirm-label"]').fill('초기화')
    await reset.getByRole('button', { name: '초기화', exact: true }).click()

    await expect(page.locator('.notice--info .notice-message')).toHaveText('금고를 초기화했습니다.')
    await expect.poll(() => currentDocId(page)).toBe(null)
    expect(await page.evaluate(() => location.hash)).toBe('#/')

    await page.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(page.locator(`.sidebar a[href="#/d/${docId}"]`)).toHaveCount(0)
    await expect(page.locator(`.sidebar li[data-folder-id="${folderId}"]`)).toHaveCount(0)
  })
})

async function reboot2074(page, hash) {
  await page.goto('about:blank')
  await page.goto('/' + hash)
}

async function twoDocs2074(page) {
  await openApp(page)
  const a = await importMarkdown(page, { name: '가.md', content: '가 문서\n' })
  const b = await importMarkdown(page, { name: '나.md', content: '나 문서\n' })
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('md.lastDocId'))).toBe(b)
  return { a, b }
}

test.describe('F-2074 부팅 첫 화면 절', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('F-2074 C1 부팅 해시가 공유 링크면 공유 화면을 연다', async ({ page, context }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    await importMarkdown(page, { name: '공유부팅.md', content: '공유 부팅 본문\n' })
    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await page.getByRole('menuitem', { name: '링크 복사' }).click()
    const link = await page.evaluate(() => navigator.clipboard.readText())
    const hash = new URL(link).hash

    await reboot2074(page, hash)
    await expect(page.locator('.shared-view')).toBeVisible()
    await expect(page.locator('.shared-view')).toContainText('공유 부팅 본문')
    expect(await page.evaluate(() => location.hash)).toContain('#/s/')
    await expect(page.locator('.notice--error')).toHaveCount(0)
  })

  test('F-2074 C2 부팅 해시의 공유 조각이 깨졌으면 알림 뒤 마지막 문서를 연다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    const { b } = await twoDocs2074(page)

    await reboot2074(page, '#/s/a')
    await expect(page.locator('.notice-message')).toHaveText('공유 링크를 읽을 수 없습니다. 주소가 잘렸는지 확인하세요.')
    await expect(page.locator('.cm-content')).toContainText('나 문서')
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(new RegExp(`#/d/${b}$`))
    await expect(page.locator('.shared-view')).toHaveCount(0)
  })

  test('F-2074 C3 부팅 해시의 문서가 없으면 알림 뒤 마지막 문서를 열고 주소를 바꾼다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    const { b } = await twoDocs2074(page)

    await reboot2074(page, '#/d/f2074-missing')
    await expect(page.locator('.notice-message')).toHaveText('문서를 찾을 수 없습니다.')
    await expect(page.locator('.cm-content')).toContainText('나 문서')
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(new RegExp(`#/d/${b}$`))
  })

  test('F-2074 C4 부팅 해시가 지도 기준 문서면 지도를 열고 마지막 문서로 적는다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    const { a } = await twoDocs2074(page)

    await reboot2074(page, `#/map/${a}`)
    await expect(page.locator('.map-page')).toBeVisible()
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(new RegExp(`#/map/${a}$`))
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('md.lastDocId'))).toBe(a)
  })
})

// ----- F-2077 세션 핵 절 -----
function serverDoc2077(id, { title, content, updatedAt = Date.now() }) {
  return { id, title, content, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: updatedAt, updatedAt }
}

async function openLive2077(page, room, docs, openId) {
  const server = await fakeServer(page)
  await page.route(/\/api\/docs\/[^/]+\/lock(\?.*)?$/, (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ expiresAt: Date.now() + 60_000 }) })
    }
    return route.fulfill({ status: 204 })
  })
  await room.install(page.context())
  for (const doc of docs) server.docs.set(doc.id, serverDoc2077(doc.id, doc))
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await page.goto(`/#/d/${openId}`)
  return server
}

// context.setOffline 은 navigator.onLine·이벤트만, fakeServer.setOffline 은 요청 실패만 만든다 — 둘을 함께
async function setOffline2077(page, server, offline) {
  server.setOffline(offline)
  await page.context().setOffline(offline)
}

test.describe('F-2077 세션 핵 절', () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  test('F-2077 C1 동기화 뒤 상대 편집도 700ms 뒤 사이드바 맨 위로 올린다', async ({ page, browser, baseURL }) => {
    const room = createFakeDocRoom()
    room.seed('f2077-x', { content: '엑스 본문', title: '엑스 문서' })
    room.seed('f2077-y', { content: '와이 본문', title: '와이 문서' })
    const now = Date.now()
    const docs = [
      { id: 'f2077-x', title: '엑스 문서', content: '엑스 본문', updatedAt: now - 10_000 },
      { id: 'f2077-y', title: '와이 문서', content: '와이 본문', updatedAt: now },
    ]
    await openLive2077(page, room, docs, 'f2077-x')
    await expect(page.locator('.cm-content').first()).toContainText('엑스 본문')
    await expect(page.locator('.statusbar-save')).toHaveText('저장됨')
    await page.waitForTimeout(1_000)
    const before = await page.locator('.doc-item-btn').allTextContents()
    expect(before.indexOf('와이 문서')).toBeLessThan(before.indexOf('엑스 문서'))

    const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' })
    try {
      const other = await context.newPage()
      await openLive2077(other, room, docs, 'f2077-x')
      await expect(other.locator('.cm-content').first()).toContainText('엑스 본문')
      await other.locator('.cm-content .cm-line', { hasText: '엑스 본문' }).first().click()
      await other.keyboard.press('End')
      await other.keyboard.type(' 원격')
      await expect.poll(() => room.content('f2077-x')).toContain(' 원격')

      await expect(page.locator('.cm-content').first()).toContainText('엑스 본문 원격')
      await expect(page.locator('.doc-item-btn').first()).toHaveText('엑스 문서', { timeout: 3_000 })
    } finally {
      await context.close()
    }
  })

  test('F-2077 C2 첫 동기화 전 오프라인이 되면 읽기 전용으로 내려가고 온라인이 되면 방 본문으로 편집한다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed('f2077-c', { content: '씨 방 본문', title: '씨 문서' })
    room.pause('f2077-c')
    const server = await openLive2077(page, room, [{ id: 'f2077-c', title: '씨 문서', content: '씨 캐시 본문' }], 'f2077-c')
    await expect(page.locator('.statusbar-save')).toHaveText('불러오는 중…')
    await expect.poll(() => room.connections('f2077-c')).toBe(1)

    await setOffline2077(page, server, true)
    const notice = '오프라인에서는 이 문서를 읽기만 할 수 있습니다. 연결되면 편집할 수 있습니다.'
    await expect(page.locator('.notice-message')).toHaveText(notice)
    await expect(page.locator('.cm-content').first()).toContainText('씨 캐시 본문')
    await expect(page.locator('.cm-content').first()).toHaveAttribute('contenteditable', 'false')

    room.resume('f2077-c')
    await setOffline2077(page, server, false)
    await expect(page.locator('.cm-content').first()).toContainText('씨 방 본문', { timeout: 5_000 })
    await expect(page.locator('.cm-content').first()).toHaveAttribute('contenteditable', 'true')
    await expect(page.getByText(notice)).toHaveCount(0)
  })
})

test.describe('F-2078 명령 팔레트 절', () => {
  test('F-2078 C1 우클릭 메뉴가 열린 채 Ctrl+P — 메뉴가 닫히고 팔레트가 열린다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문 줄\n' })
    const line = page.locator('.cm-line', { hasText: '본문 줄' }).first()
    await rightClick(page, line)
    await expect(root(page)).toBeVisible()
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.context-menu-root'))).toBe(true)

    await page.keyboard.press('Control+p')
    await expect(page.locator('dialog[open] .command-palette')).toBeVisible()
    await expect(root(page)).toHaveCount(0)
    await expect(page.locator('.command-palette-input')).toBeFocused()
  })
})

test.describe('F-2079 계정 상태 절', () => {
  const L5 = '이 계정은 운영자가 쓰기를 막았습니다. 문서 읽기와 내보내기만 할 수 있습니다.'
  const L7 = '운영자가 이 계정의 사용 방식에 주의를 보냈습니다. 이용약관 제7조(금지 행위)를 확인해 주세요. 계속되면 쓰기가 막힐 수 있습니다.'

  const countMeOnVisible = (page) => page.evaluate(() => {
    const original = window.fetch
    let count = 0
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (new URL(url, location.href).pathname === '/api/me') count++
      return original(input, init)
    }
    try {
      document.dispatchEvent(new Event('visibilitychange'))
    } finally {
      window.fetch = original
    }
    return count
  })

  test('F-2079 C1 online 이 오면 /api/me 를 다시 읽어 막힘과 풀림을 반영한다', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')

    server.setMe({ blocked: true })
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(page.locator('.notice-message')).toHaveText(L5)
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')

    server.setMe({ blocked: false })
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(page.locator('.notice-message')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')
  })

  test('F-2079 C2 화면 복귀는 마지막 확인 10분 안이면 /api/me 를 읽지 않고, 지나면 읽는다', async ({ page }) => {
    await page.clock.install()
    const server = await fakeServer(page)
    await openApp(page)
    await expect(page.locator('.cm-content')).toBeVisible()

    await page.clock.fastForward('09:00')
    expect(await countMeOnVisible(page)).toBe(0)

    server.setMe({ warned: true })
    await page.clock.fastForward('01:01')
    expect(await countMeOnVisible(page)).toBe(1)
    await expect(page.locator('.notice--warn .notice-message')).toHaveText(L7)
  })
})

// F-2074 C1 과 같은 길로 공유 화면을 열고 가져온 문서 id 를 돌려준다
async function openSharedView2082(page, context, name, content) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openApp(page)
  const docId = await importMarkdown(page, { name, content })
  await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
  await page.getByRole('menuitem', { name: '링크 복사' }).click()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  const hash = new URL(link).hash
  await page.goto('about:blank')
  await page.goto('/' + hash)
  await expect(page.locator('.shared-view')).toBeVisible()
  return docId
}

test.describe('F-2082 문서 이동 절', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('F-2082 C1 공유 화면 내 문서로 가져오기 — 새 문서로 열고 주소를 바꾼다', async ({ page, context }) => {
    const importedId = await openSharedView2082(page, context, '가져올.md', '가져올 본문\n')
    const historyLenBefore = await page.evaluate(() => history.length)

    await page.locator('.shared-view-notice').getByRole('button', { name: '내 문서로 가져오기' }).click()

    await expect(page.locator('.shared-view')).toHaveCount(0)
    await expect(page.locator('.notice-message')).toHaveText('내 문서로 가져왔습니다.')
    await expect(page.locator('.cm-content')).toContainText('가져올 본문')
    const newId = await currentDocId(page)
    expect(newId).not.toBe(importedId)
    expect(await page.evaluate(() => location.hash)).toBe(`#/d/${newId}`)
    expect(await page.evaluate(() => history.length)).toBe(historyLenBefore)
  })

  test('F-2082 C2 공유 화면 닫기 — 마지막으로 연 문서로 돌아간다', async ({ page, context }) => {
    const importedId = await openSharedView2082(page, context, '돌아갈.md', '돌아갈 본문\n')

    await page.locator('.shared-view-notice').getByRole('button', { name: '닫기' }).click()

    await expect(page.locator('.shared-view')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('돌아갈 본문')
    expect(await currentDocId(page)).toBe(importedId)
  })

  test('F-2082 C3 공유 관리에서 폴더 이름 클릭 — 홈으로 가며 그 폴더를 펼친다', async ({ page }) => {
    const server = await fakeServer(page)
    seedFolder(server, { id: 'f2082', name: '업무' })
    seedDoc(server, { id: 'd2082', title: '폴더 안 문서', folderId: 'f2082' })
    seedDoc(server, { id: 'd2082top', title: '밖 문서' })
    seedLink(server, { targetType: 'folder', targetId: 'f2082', token: 'tok-f2082' })
    await setPrefBeforeLoad(page, 'md.lastDocId', 'd2082top')

    await openApp(page)
    expect((await readOpenFolders(page)) ?? []).not.toContain('f2082')
    await openShares(page)

    await page.locator('.shares-target-btn').click()

    await expect(page.locator('.shares-page-head')).toHaveCount(0)
    await expect(page.locator('.empty-state')).toBeVisible()
    expect(await page.evaluate(() => location.hash)).toBe('#/')
    await expect.poll(() => readOpenFolders(page)).toContain('f2082')
    await expect(page.locator('.sidebar .tree-label').filter({ hasText: '폴더 안 문서' })).toBeVisible()
  })
})
