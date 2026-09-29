// 보기 화면 목록을 편집 화면과 같게 (specs/features/F-226.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, waitSaved, readSavedContent, rectOf } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

// F-226 A1~A5(기호·글자 x, 글머리 색·굵기, 숫자 캡처, 세로 간격)는 시각 값이라 e2e 에서 뺐다 — specs/human-checks.md (2026-09-25 e2e 경량화)

// DELETE 를 늦춰 confirmDelete 의 재조정 경합을 재현하고, delete-all 캐스케이드를 여기서 직접 흉낸다 (F-247.md)
async function delayFolderDeletes(page, server, ms = 500) {
  await page.route(/\/api\/folders\/[^/]+\?contents=/, async (route) => {
    const req = route.request()
    if (req.method() !== 'DELETE') return route.fallback()
    await new Promise((resolve) => setTimeout(resolve, ms))
    const url = new URL(req.url())
    const id = decodeURIComponent(url.pathname.split('/').pop())
    const mode = url.searchParams.get('contents') ?? 'move-up'
    if (mode === 'delete-all') {
      const subIds = [...server.folders.values()].filter((f) => f.parentId === id).map((f) => f.id)
      const ids = [id, ...subIds]
      for (const [docId, doc] of server.docs) if (doc.folderId && ids.includes(doc.folderId)) server.docs.delete(docId)
      for (const fid of ids) server.folders.delete(fid)
    } else {
      server.folders.delete(id)
    }
    return route.fulfill({ status: 204 })
  })
}

async function buildTopSubDoc(page) {
  await page.getByRole('button', { name: '새 폴더', exact: true }).click()
  await expect(page.locator('.tree-rename-input')).toBeFocused()
  await page.keyboard.type('위')
  await page.keyboard.press('Enter')

  const topRow = page.locator('.tree-row').filter({ hasText: '위' })
  await topRow.hover()
  await topRow.locator('.item-menu-btn').click()
  await topRow.getByRole('menuitem', { name: '하위 폴더' }).click()
  await expect(page.locator('.tree-rename-input')).toBeFocused()
  await page.keyboard.type('아래')
  await page.keyboard.press('Enter')

  const subRow = page.locator('.tree-row').filter({ hasText: '아래' })
  await subRow.hover()
  await subRow.locator('.item-menu-btn').click()
  await subRow.getByRole('menuitem', { name: '새 문서' }).click()
  await page.locator('.doc-title').fill('문서')
  await page.locator('.cm-content').click()
  await page.keyboard.type('내용')
  await waitSaved(page)
}

async function deleteTopFolder(page, buttonName) {
  const topRow = page.locator('.tree-row').filter({ hasText: '위' })
  await topRow.hover()
  await topRow.locator('.item-menu-btn').click()
  await topRow.getByRole('menuitem', { name: '삭제' }).click()
  await page.getByRole('button', { name: buttonName, exact: true }).click()
}

// 재조정 경합 논리는 src/storage/serverStore.test.ts F-247 A1·A2(전부 삭제)·A3(위로 옮기기)·A4(outbox 뒤 일치)가 본다. A8 위로 옮기기 화면 동작은 F-242 A9 가 본다
test.describe('F-247 A7 전부 삭제 스모크', () => {
  test('DELETE 가 늦어도 전부 삭제한 하위 폴더·그 안 문서가 되살아나지 않는다', async ({ page }) => {
    const server = await fakeServer(page)
    await delayFolderDeletes(page, server)
    await openApp(page)

    await buildTopSubDoc(page)
    await deleteTopFolder(page, '전부 삭제')

    const rows = page.locator('.tree-row')
    await expect(rows.filter({ hasText: '위' })).toHaveCount(0)
    await expect(rows.filter({ hasText: '아래' })).toHaveCount(0)
    // hasText 부분열이면 openApp 이 빈 저장소에서 만든 "제목 없는 문서" 줄까지 걸린다 — 제목 정확 일치로 좁힌다 (F-257 7.3)
    await expect(rows.filter({ hasText: /^문서$/ })).toHaveCount(0)

    await expect.poll(() => server.folders.size).toBe(0)
    await expect(rows.filter({ hasText: '아래' })).toHaveCount(0)
    await expect(rows.filter({ hasText: /^문서$/ })).toHaveCount(0)
  })
})

// 폴더 삭제 — 위로 옮기기/전부 삭제 선택 (specs/features/F-242.md)
async function createFolder(page) {
  await page.getByRole('button', { name: '새 폴더', exact: true }).click()
  // 포커스가 이름 입력 칸으로 옮겨가기 전에 Enter 를 누르면 "새 폴더" 버튼이 한 번 더 눌려 폴더가 두 개 생긴다
  const renameInput = page.locator('.tree-rename-input')
  await expect(renameInput).toBeFocused()
  await page.keyboard.press('Enter') // 이름 그대로 커밋
  return page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') }).first()
}

async function openFolderMenu(folderRow) {
  const menuBtn = folderRow.locator('.item-menu-btn')
  await menuBtn.focus()
  await menuBtn.click()
  return menuBtn
}

async function addDocInFolder(folderRow, page) {
  await openFolderMenu(folderRow)
  await page.getByRole('menuitem', { name: '새 문서' }).click()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
}

async function requestDeleteFolder(folderRow, page) {
  await openFolderMenu(folderRow)
  await page.getByRole('menuitem', { name: '삭제' }).click()
  return page.locator('dialog[open]')
}


test.describe('F-242 A9 위로 옮기기', () => {
  test('문서가 상위로 옮겨지고 폴더만 사라진다', async ({ page }) => {
    await openApp(page)
    const folderRow = await createFolder(page)
    await addDocInFolder(folderRow, page)
    const docRowCount = await page.locator('.tree-row').filter({ has: page.locator('.tree-toggle-spacer') }).count()

    const dialog = await requestDeleteFolder(folderRow, page)
    await dialog.getByRole('button', { name: '위로 옮기기' }).click()

    await expect(page.locator('.tree-toggle')).toHaveCount(0)
    // 문서는 지워지지 않고 그대로 남는다 — 폴더만 사라져 트리 깊이만 얕아진다
    await expect(page.locator('.tree-row').filter({ has: page.locator('.tree-toggle-spacer') })).toHaveCount(docRowCount)
  })
})

test.describe('F-242 A11 빈 폴더', () => {
  test('삭제를 누르면 폴더만 사라진다', async ({ page }) => {
    await openApp(page)
    const folderRow = await createFolder(page)

    const dialog = await requestDeleteFolder(folderRow, page)
    await dialog.getByRole('button', { name: '삭제', exact: true }).click()
    await expect(page.locator('.tree-toggle')).toHaveCount(0)
  })
})

test.describe('F-242 A10·A12 전부 삭제', () => {
  test('F-242 A10·A12 폴더와 안의 문서가 사이드바에서 사라지고, 열어 둔 문서였으면 홈 화면으로 돌아간다', async ({ page }) => {
    await openApp(page)
    const folderRow = await createFolder(page)
    await addDocInFolder(folderRow, page)
    const docRowCount = await page.locator('.tree-row').filter({ has: page.locator('.tree-toggle-spacer') }).count()

    const dialog = await requestDeleteFolder(folderRow, page)
    await dialog.getByRole('button', { name: '전부 삭제' }).click()

    await expect(page.locator('.tree-toggle')).toHaveCount(0)
    await expect(page.locator('.tree-row').filter({ has: page.locator('.tree-toggle-spacer') })).toHaveCount(docRowCount - 1)
    await expect(page.locator('.empty-state')).toBeVisible()
    expect(await page.evaluate(() => location.hash)).toBe('#/')
  })
})

// 새 폴더 직후 Enter 로 폴더가 두 개 생기는 문제 (F-246.md) — Enter 재진입을 같은 턴 연속 클릭으로 결정적으로 재현한다
async function raceClickButton(page, label, times = 2) {
  await page.evaluate(
    ({ label, times }) => {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.getAttribute('aria-label') === label || b.textContent.trim() === label,
      )
      if (!btn) throw new Error(`button not found: ${label}`)
      for (let i = 0; i < times; i++) btn.click()
    },
    { label, times },
  )
}

test.describe('F-246 A1·A2·A3·A4 Enter 재진입 경합', () => {
  test('F-246 A1·A2·A3·A4 사이드바 버튼·연타·레일 버튼·하위 폴더에서 바로 Enter 를 쳐도 폴더는 하나씩만 생긴다', async ({ page }) => {
    await openApp(page)
    const renameInput = page.locator('.tree-rename-input')
    const toggles = page.locator('.tree-toggle')

    // A1 사이드바 버튼 + Enter — 폴더 하나, 이름 칸에 포커스
    await raceClickButton(page, '새 폴더')
    await expect(renameInput).toBeFocused()
    await expect(toggles).toHaveCount(1)
    await page.keyboard.press('Enter')

    // A2 연타 — Enter 3번이어도 폴더는 하나 더
    await raceClickButton(page, '새 폴더', 3)
    await expect(renameInput).toBeFocused()
    await expect(toggles).toHaveCount(2)
    await page.keyboard.press('Enter')

    // A3 레일 버튼 — 펼쳐지고 이름 칸 포커스, 폴더 하나 더
    await page.locator('.sidebar-toggle').click() // 레일로 접기
    await expect(page.locator('.sidebar')).toHaveClass(/sidebar--collapsed/)
    await raceClickButton(page, '새 폴더')
    await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--collapsed/)
    await expect(renameInput).toBeFocused()
    await expect(toggles).toHaveCount(3)
    await page.keyboard.press('Enter')

    // A4 하위 폴더 — 그 폴더 안에 하나만
    const parentRow = page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') }).first()
    await openFolderMenu(parentRow)
    await raceClickButton(page, '하위 폴더')
    await expect(renameInput).toBeFocused()
    await expect(toggles).toHaveCount(4)
  })
})

test.describe('F-246 A5·A6 정상 흐름 회귀', () => {
  test('F-246 A5·A6 새 폴더 이름 저장, 확정 뒤 다시 눌러도 정상으로 만들어진다', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '새 폴더', exact: true }).click()
    const renameInput = page.locator('.tree-rename-input')
    await expect(renameInput).toBeFocused()
    await page.keyboard.type('내 폴더')
    await page.keyboard.press('Enter')

    await expect(page.locator('.tree-toggle')).toHaveCount(1)
    await expect(page.locator('.tree-row').filter({ hasText: '내 폴더' })).toHaveCount(1)

    // 방금 만든 폴더 이름이 기본값 "새 폴더" 일 수 있어 사이드바 만들기 버튼만 짚는다
    await page.locator('.sidebar-actions').getByRole('button', { name: '새 폴더', exact: true }).click()
    await expect(renameInput).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page.locator('.tree-toggle')).toHaveCount(2)
  })
})

// 커서가 기호 위에 있을 때만 목록 기호를 원문으로 (specs/features/F-254.md)
// 체크박스는 줄 전체 활성 판정을 그대로 쓴다 — 명세 3.2 C8 과 다른 예외, F-166 A4(e2e/editor.spec.js) 회귀(2026-09-18) 조사 후 메인 확인, lines.ts TaskMarker 분기 주석 참고
test.describe('F-254 C8 예외 — 체크박스', () => {
  test('줄에 커서가 있으면(본문 포함) 원문 `- [ ] ` 그대로 남고, 커서가 없으면 체크박스 위젯으로 바뀐다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- [ ] 하나\nx' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('End') // 커서: 첫 줄('하나' 뒤, 본문)

    const line = page.locator('.cm-line.md-list-line').first()
    await expect(line.locator('.md-checkbox')).toHaveCount(0)
    expect(await line.textContent()).toContain('- [ ] 하나')

    await page.keyboard.press('Control+End') // 커서: 둘째 줄('x')
    await expect(line.locator('.md-checkbox')).toBeVisible()
    expect(await line.textContent()).not.toContain('- [')
  })
})

test.describe('F-254 C10·C11 포커스 없음과 기호 편집', () => {
  test('F-254 C10·C11 편집기 밖 클릭이면 기호 구역 커서여도 보기 모드로 돌아가고, 기호 구역에서 `- ` 를 지우고 다시 쳐도 정상 편집된다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '- 하나\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home') // 기호 구역

    const line = page.locator('.cm-line.md-list-line').first()
    await expect(line.locator('.md-bullet')).toHaveCount(0)

    // 문서 칸 왼쪽 여백을 클릭해 포커스만 없앤다 (e2e/margin.spec.js 와 같은 방식)
    const scrollerRect = await rectOf(page.locator('.cm-scroller'))
    await page.mouse.click(scrollerRect.left + 10, scrollerRect.top + scrollerRect.height / 2)
    await expect(line.locator('.md-bullet')).toBeVisible()

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('Delete')
    await page.keyboard.press('Delete') // '- ' 두 글자 지움
    await page.keyboard.type('- ')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toBe('- 하나\n')
  })
})
