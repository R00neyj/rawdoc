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

test.describe('F-247 A7 전부 삭제', () => {
  test('상위 폴더를 전부 삭제하면 하위 폴더·그 안 문서가 되살아나지 않는다', async ({ page }) => {
    const server = await fakeServer(page)
    await delayFolderDeletes(page, server)
    await openApp(page)

    await buildTopSubDoc(page)
    await deleteTopFolder(page, '전부 삭제')

    await expect(page.locator('.tree-row').filter({ hasText: '위' })).toHaveCount(0)
    await expect(page.locator('.tree-row').filter({ hasText: '아래' })).toHaveCount(0)
    await expect(page.locator('.tree-row').filter({ hasText: '문서' })).toHaveCount(0)

    // DELETE 가 실제로 서버에 닿을 때까지 기다린 뒤 새로 고침해도 그대로다
    await page.waitForTimeout(700)
    await page.reload()
    await expect(page.locator('.cm-host .cm-editor, .empty-state')).toBeVisible()
    await expect(page.locator('.tree-row').filter({ hasText: '위' })).toHaveCount(0)
    await expect(page.locator('.tree-row').filter({ hasText: '아래' })).toHaveCount(0)
    await expect(page.locator('.tree-row').filter({ hasText: '문서' })).toHaveCount(0)
  })
})

test.describe('F-247 A8 위로 옮기기', () => {
  test('상위 폴더를 위로 옮기면 하위 폴더·문서가 사라지지 않는다', async ({ page }) => {
    const server = await fakeServer(page)
    await delayFolderDeletes(page, server)
    await openApp(page)

    await buildTopSubDoc(page)
    await deleteTopFolder(page, '위로 옮기기')

    await expect(page.locator('.tree-row').filter({ hasText: '위' })).toHaveCount(0)
    await expect(page.locator('.tree-row').filter({ hasText: '아래' })).toHaveCount(1)

    await page.waitForTimeout(700)
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

test.describe('F-242 A8 폴더 삭제 선택지', () => {
  test('문서가 든 폴더 삭제 — 대화상자에 위로 옮기기·전부 삭제 두 버튼', async ({ page }) => {
    await openApp(page)
    const folderRow = await createFolder(page)
    await addDocInFolder(folderRow, page)

    const dialog = await requestDeleteFolder(folderRow, page)
    await expect(dialog.getByRole('button', { name: '위로 옮기기' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '전부 삭제' })).toBeVisible()
  })
})

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

test.describe('F-242 A10 전부 삭제', () => {
  test('폴더와 안의 문서가 사이드바에서 사라진다', async ({ page }) => {
    await openApp(page)
    const folderRow = await createFolder(page)
    await addDocInFolder(folderRow, page)
    const docRowCount = await page.locator('.tree-row').filter({ has: page.locator('.tree-toggle-spacer') }).count()

    const dialog = await requestDeleteFolder(folderRow, page)
    await dialog.getByRole('button', { name: '전부 삭제' }).click()

    await expect(page.locator('.tree-toggle')).toHaveCount(0)
    await expect(page.locator('.tree-row').filter({ has: page.locator('.tree-toggle-spacer') })).toHaveCount(docRowCount - 1)
  })
})

test.describe('F-242 A11 빈 폴더', () => {
  test('버튼이 취소·삭제 두 개뿐이고, 누르면 폴더만 사라진다', async ({ page }) => {
    await openApp(page)
    const folderRow = await createFolder(page)

    const dialog = await requestDeleteFolder(folderRow, page)
    await expect(dialog.locator('.dialog-actions button')).toHaveCount(2)
    await expect(dialog.getByRole('button', { name: '취소' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '삭제', exact: true })).toBeVisible()

    await dialog.getByRole('button', { name: '삭제', exact: true }).click()
    await expect(page.locator('.tree-toggle')).toHaveCount(0)
  })
})

test.describe('F-242 A12 열린 문서가 지워짐', () => {
  test('열어 둔 문서가 든 폴더를 전부 삭제하면 홈 화면으로 돌아간다', async ({ page }) => {
    await openApp(page)
    const folderRow = await createFolder(page)
    await addDocInFolder(folderRow, page)

    const dialog = await requestDeleteFolder(folderRow, page)
    await dialog.getByRole('button', { name: '전부 삭제' }).click()

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

test.describe('F-246 A1 사이드바 버튼 + Enter', () => {
  test('대기 없이 바로 Enter 를 쳐도 폴더는 하나만 생기고 이름 칸에 포커스가 있다', async ({ page }) => {
    await openApp(page)
    await raceClickButton(page, '새 폴더')

    const renameInput = page.locator('.tree-rename-input')
    await expect(renameInput).toBeFocused()
    await expect(page.locator('.tree-toggle')).toHaveCount(1)
  })
})

test.describe('F-246 A2 연타', () => {
  test('Enter 를 3번 연속 쳐도 폴더는 하나', async ({ page }) => {
    await openApp(page)
    await raceClickButton(page, '새 폴더', 3)

    await expect(page.locator('.tree-toggle')).toHaveCount(1)
  })
})

test.describe('F-246 A3 레일 버튼', () => {
  test('사이드바 접은 상태에서 레일 새 폴더 → 바로 Enter — 폴더 하나, 펼쳐지고 이름 칸 포커스', async ({ page }) => {
    await openApp(page)
    await page.locator('.sidebar-toggle').click() // 레일로 접기
    await expect(page.locator('.sidebar')).toHaveClass(/sidebar--collapsed/)

    await raceClickButton(page, '새 폴더')

    await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--collapsed/)
    const renameInput = page.locator('.tree-rename-input')
    await expect(renameInput).toBeFocused()
    await expect(page.locator('.tree-toggle')).toHaveCount(1)
  })
})

test.describe('F-246 A4 하위 폴더', () => {
  test('하위 폴더 만들기 → 바로 Enter — 그 폴더 안에 하나만', async ({ page }) => {
    await openApp(page)
    const parentRow = await createFolder(page)

    await openFolderMenu(parentRow)
    await raceClickButton(page, '하위 폴더')

    const renameInput = page.locator('.tree-rename-input')
    await expect(renameInput).toBeFocused()
    // 부모 폴더 + 하위 폴더 = 토글 2개. 하위가 둘이면 3개가 된다
    await expect(page.locator('.tree-toggle')).toHaveCount(2)
  })
})

test.describe('F-246 A5 정상 흐름 회귀', () => {
  test('새 폴더 → 이름 칸에 이름 치고 Enter — 이름이 저장된다', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '새 폴더', exact: true }).click()
    const renameInput = page.locator('.tree-rename-input')
    await expect(renameInput).toBeFocused()
    await page.keyboard.type('내 폴더')
    await page.keyboard.press('Enter')

    await expect(page.locator('.tree-toggle')).toHaveCount(1)
    await expect(page.locator('.tree-row').filter({ hasText: '내 폴더' })).toHaveCount(1)
  })
})

test.describe('F-246 A6 연속으로 두 번 만들기', () => {
  test('폴더 하나 만들어 이름 확정 뒤, 다시 새 폴더를 눌러도 정상으로 만들어진다', async ({ page }) => {
    await openApp(page)
    await createFolder(page)
    await expect(page.locator('.tree-toggle')).toHaveCount(1)

    // 방금 만든 폴더 이름이 기본값 "새 폴더" 라 트리 안에도 같은 이름 버튼이 생긴다 — 사이드바 만들기 버튼만 짚는다
    // (2026-09-21: 0705550 에서 이 버튼이 .sidebar-btn 에서 아이콘 버튼으로 바뀌어 셀렉터를 고쳤다)
    await page.locator('.sidebar-actions').getByRole('button', { name: '새 폴더', exact: true }).click()
    const renameInput = page.locator('.tree-rename-input')
    await expect(renameInput).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page.locator('.tree-toggle')).toHaveCount(2)
  })
})

// 커서가 기호 위에 있을 때만 목록 기호를 원문으로 (specs/features/F-254.md)
test.describe('F-254 C1 본문 커서', () => {
  test('본문에 커서 — 불릿 위젯 유지, 원문 `- ` 안 보임', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 하나\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('End') // 커서: '나' 뒤(본문) — 문서 끝에는 빈 줄이 하나 더 있어 Control+End 는 쓰지 않는다

    const line = page.locator('.cm-line.md-list-line').first()
    await expect(line.locator('.md-bullet')).toBeVisible()
    expect(await line.textContent()).not.toContain('-')
  })
})

test.describe('F-254 C2 기호 커서', () => {
  test('Home — 원문 `- ` 그대로 보인다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 하나\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('End')
    await page.keyboard.press('Home')

    const line = page.locator('.cm-line.md-list-line').first()
    await expect(line.locator('.md-bullet')).toHaveCount(0)
    expect(await line.textContent()).toContain('- 하나')
  })
})

test.describe('F-254 C3 기호 직후', () => {
  test('본문 첫 글자 바로 앞도 기호 구역이라 원문 그대로', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 하나\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight') // '- ' 뒤, '하' 바로 앞

    const line = page.locator('.cm-line.md-list-line').first()
    await expect(line.locator('.md-bullet')).toHaveCount(0)
    expect(await line.textContent()).toContain('- 하나')
  })
})

// F-254 C4 좌우 흔들림(x 1px)은 시각 값이라 e2e 에서 뺐다 (2026-09-25 e2e 경량화)

test.describe('F-254 C5 중첩 들여쓰기 유지', () => {
  test('둘째 줄 본문에 커서 — 고정 폭 위젯 유지', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 하나\n  - 둘\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('End') // 커서: 둘째 줄('둘') 뒤(본문)

    const lines = page.locator('.cm-line.md-list-line')
    const widget = lines.nth(1).locator('.md-list-indent-step')
    await expect(widget).toHaveCount(1) // 고정 폭 스페이서는 장식용이라 높이 0 — toBeVisible 대신 존재·폭으로 판정
    expect(await widget.getAttribute('style')).toContain('--md-list-indent-steps: 1')
  })
})

test.describe('F-254 C6 중첩 기호 커서', () => {
  test('둘째 줄 Home — 원문 공백 + `- ` 로 보인다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 하나\n  - 둘\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Home')

    const lines = page.locator('.cm-line.md-list-line')
    await expect(lines.nth(1).locator('.md-list-indent-step')).toHaveCount(0)
    await expect(lines.nth(1).locator('.md-bullet')).toHaveCount(0)
    expect(await lines.nth(1).textContent()).toContain('  - 둘')
  })
})

test.describe('F-254 C7 순서 목록', () => {
  test('본문에 커서 — md-list-marker 폭 유지', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '1. 하나\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')

    const line = page.locator('.cm-line.md-list-line').first()
    await expect(line.locator('.md-list-marker')).toBeVisible()
  })
})

// 체크박스는 줄 전체 활성 판정을 그대로 쓴다 — 명세 3.2 C8 과 다른 예외, F-166 A4(e2e/editor.spec.js) 회귀(2026-09-18) 조사 후 메인 확인, lines.ts TaskMarker 분기 주석 참고
test.describe('F-254 C8 예외 — 체크박스', () => {
  test('줄에 커서가 있으면(본문 포함) 원문 `- [ ] ` 그대로 남는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- [ ] 하나\nx' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('End') // 커서: 첫 줄('하나' 뒤, 본문)

    const line = page.locator('.cm-line.md-list-line').first()
    await expect(line.locator('.md-checkbox')).toHaveCount(0)
    expect(await line.textContent()).toContain('- [ ] 하나')
  })

  test('커서가 없으면 지금처럼 체크박스 위젯으로 바뀐다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- [ ] 하나\nx' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End') // 커서: 둘째 줄('x')

    const line = page.locator('.cm-line.md-list-line').first()
    await expect(line.locator('.md-checkbox')).toBeVisible()
    expect(await line.textContent()).not.toContain('- [')
  })
})

test.describe('F-254 C9 선택 범위', () => {
  test('줄 전체를 드래그 선택하면 기호 구역을 걸치므로 원문', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 하나\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.down('Shift')
    await page.keyboard.press('End')
    await page.keyboard.up('Shift')

    const line = page.locator('.cm-line.md-list-line').first()
    await expect(line.locator('.md-bullet')).toHaveCount(0)
  })
})

test.describe('F-254 C10 포커스 없음', () => {
  test('편집기 밖 클릭 — 기호 구역에 커서가 있어도 보기 모드로 돌아간다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 하나\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home') // 기호 구역

    const line = page.locator('.cm-line.md-list-line').first()
    await expect(line.locator('.md-bullet')).toHaveCount(0)

    // 문서 칸 왼쪽 여백을 클릭해 포커스만 없앤다 (e2e/margin.spec.js 와 같은 방식)
    const scrollerRect = await rectOf(page.locator('.cm-scroller'))
    await page.mouse.click(scrollerRect.left + 10, scrollerRect.top + scrollerRect.height / 2)

    await expect(line.locator('.md-bullet')).toBeVisible()
  })
})

test.describe('F-254 C11 기호 편집', () => {
  test('기호 구역에서 `- ` 를 지우고 다시 쳐도 정상 편집된다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '- 하나\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home') // 기호 구역(Home)

    await page.keyboard.press('Delete')
    await page.keyboard.press('Delete') // '- ' 두 글자 지움
    await page.keyboard.type('- ')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toBe('- 하나\n')
  })
})
