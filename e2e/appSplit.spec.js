// App.tsx 분할 특성 테스트 — 옮기기 전 동작을 고정한다 (specs/features/F-2059.md 5.2)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setViewMode, readSavedContent, setPrefBeforeLoad, resizeWindow, currentDocId, waitSaved } from './helpers.js'
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

  test('F-2064 C1 불러오는 중 문구', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: '회의록' })
    seedLink(server, { targetType: 'doc', targetId: 'd1', token: 'tok-doc' })
    await openApp(page)
    const gate = deferred()
    await page.route('**/api/shares', async (route) => {
      await gate.promise
      return route.fallback()
    })

    await openShares(page)
    await expect(page.locator('.shares-loading')).toHaveText('불러오는 중…')
    await expect(rows(page)).toHaveCount(0)

    gate.resolve()
    await expect(rows(page)).toHaveCount(1)
    await expect(page.locator('.shares-loading')).toHaveCount(0)
  })

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
    await page.getByRole('button', { name: '로그인' }).click()
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
    await runPaletteCommand(page, '>사이드바 접기')
    await expect(sidebar).toHaveClass(/sidebar--collapsed/)
    await expect.poll(() => readPref(page, 'md.sidebar')).toBe('collapsed')

    await runPaletteCommand(page, '>사이드바 펴기')
    await expect(sidebar).not.toHaveClass(/sidebar--collapsed/)
    await expect.poll(() => readPref(page, 'md.sidebar')).toBe('expanded')

    await resizeWindow(page, 900)
    await expect(sidebar).toBeHidden()
    await runPaletteCommand(page, '>사이드바 열기')
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

    await runPaletteCommand(page, '>이 문서 상단 고정')
    await expect(page.locator('.pinned-list .tree-row')).toHaveCount(1)
    await runPaletteCommand(page, '>이 문서 고정 해제')
    await expect(page.locator('.pinned-list')).toHaveCount(0)

    await folderToggle(page, '가 접기').click()
    await expect(folderToggle(page, '가 펼치기')).toBeVisible()
    await runPaletteCommand(page, '>이 문서 폴더로 이동…')
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
