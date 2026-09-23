// 명령 팔레트와 템플릿 삽입 (specs/features/F-2022.md)
import { test, expect } from '@playwright/test'
import { openApp, openAppHome, importMarkdown, readSavedContent, setViewMode } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const FIXED_NOW = new Date(2026, 8, 23, 9, 5, 7) // 2026-09-23 09:05:07 수요일 (11.2)

const palette = (page) => page.locator('dialog[open] .command-palette')
const paletteOptions = (page) => palette(page).getByRole('option')

async function stubPrint(page) {
  await page.addInitScript(() => {
    window.printLog = { calls: 0 }
    window.print = () => {
      window.printLog.calls += 1
    }
  })
}

async function printCallCount(page) {
  return page.evaluate(() => window.printLog?.calls ?? 0)
}

async function fillTitle(page, text) {
  await page.locator('.doc-title').fill(text)
  await page.locator('.doc-title').blur()
}

async function newTopDoc(page) {
  await page.getByRole('button', { name: '새 문서' }).click()
  // 폴더 메뉴로 문서를 만든 직후엔 제목 자동 포커스가 빌 때가 있다(F-2022 범위 밖 버그) — 보이는지만 본다
  await expect(page.locator('.doc-title')).toBeVisible()
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
  // 폴더 메뉴 새 문서는 제목 입력 자동 포커스가 F-2022 범위 밖이라 여기서 못박지 않는다 — 제목이 보이는지만 확인
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
  // dialog 의 close 이벤트(포커스 복귀, Dialog.tsx)는 close() 와 같은 틱이 아니라 나중 태스크라 한 틱 흘려보낸다(F-146 A4 류 경합)
  await expect(page.locator('.dialog[open]')).toHaveCount(0)
  await page.waitForTimeout(50)
}

test.describe('F-2022 A1 Ctrl+P 로 열기', () => {
  test('편집 모드 본문 클릭 → Ctrl+P — 팔레트가 뜨고 입력칸에 포커스, 1단계 옵션 순서', async ({ page }) => {
    await stubPrint(page)
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await page.locator('.cm-content').click()

    await page.keyboard.press('Control+p')

    await expect(palette(page)).toBeVisible()
    await expect(palette(page).locator('h2')).toHaveText('명령 팔레트')
    await expect(palette(page).locator('.command-palette-input')).toBeFocused()
    const options = paletteOptions(page)
    await expect(options).toHaveCount(2)
    await expect(options.nth(0)).toHaveText(/템플릿 삽입/)
    await expect(options.nth(1)).toHaveText(/PDF \(A4 인쇄\)/)
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true')
    expect(await printCallCount(page)).toBe(0)
  })
})

test.describe('F-2022 A2 거르기', () => {
  test('템플·pdf·ㅋㅋㅋ', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+p')

    await palette(page).locator('.command-palette-input').fill('템플')
    await expect(paletteOptions(page)).toHaveCount(1)
    await expect(paletteOptions(page).first()).toHaveText(/템플릿 삽입/)

    await palette(page).locator('.command-palette-input').fill('pdf')
    await expect(paletteOptions(page)).toHaveCount(1)
    await expect(paletteOptions(page).first()).toHaveText(/PDF/)

    await palette(page).locator('.command-palette-input').fill('ㅋㅋㅋ')
    await expect(paletteOptions(page)).toHaveCount(0)
    await expect(palette(page).locator('.command-palette-status')).toHaveText('맞는 명령이 없습니다')
  })
})

test.describe('F-2022 A3 2단계와 내장 목록', () => {
  test('새 문서(빈 본문) — Enter 로 템플릿 삽입 2단계, 내장 4개', async ({ page }) => {
    await openApp(page)
    await newTopDoc(page)
    await page.locator('.doc-title').press('Escape').catch(() => {})
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+p')
    await page.keyboard.press('Enter')

    await expect(palette(page).locator('h2')).toHaveText('템플릿 삽입')
    await expect(palette(page).locator('.command-palette-input')).toHaveValue('')
    const options = paletteOptions(page)
    await expect(options).toHaveCount(4)
    await expect(options.nth(0)).toHaveText(/회의록/)
    await expect(options.nth(1)).toHaveText(/일일 노트/)
    await expect(options.nth(2)).toHaveText(/버그 보고/)
    await expect(options.nth(3)).toHaveText(/주간 회고/)
    for (let i = 0; i < 4; i++) {
      await expect(options.nth(i).locator('.command-palette-item-detail')).toHaveText('내장')
    }
    await expect(palette(page).locator('.command-palette-hint')).toHaveText(
      "최상위에 '템플릿' 폴더를 만들고 문서를 넣으면 여기에 함께 나옵니다.",
    )
  })
})

test.describe('F-2022 A4 내장 템플릿 넣기', () => {
  test('회의록 넣기 — 저장된 본문·포커스·커서 자리', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await openApp(page)
    const docId = await importMarkdown(page, { content: '본문\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+p')
    await page.keyboard.press('Enter') // 템플릿 삽입 2단계
    await palette(page).locator('.command-palette-input').fill('회의')
    await page.keyboard.press('Enter')

    await expect(palette(page)).toHaveCount(0)
    const saved = await readSavedContent(page, docId)
    expect(saved.content).toBe(
      '본문\n\n## 회의 — 2026-09-23\n\n- 참석:\n- 안건:\n\n### 논의\n\n### 결정\n\n### 할 일\n\n- [ ] ',
    )

    const focused = await page.evaluate(() => document.activeElement?.closest('.cm-content') != null)
    expect(focused).toBe(true)
    await page.keyboard.type('x')
    await expect(page.locator('.cm-line', { hasText: '[ ] x' })).toBeVisible()
  })
})

test.describe('F-2022 A5 되돌리기 1번', () => {
  test('템플릿 삽입 뒤 Ctrl+Z 한 번 — 원래대로', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await openApp(page)
    const docId = await importMarkdown(page, { content: '본문\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Control+p')
    await page.keyboard.press('Enter')
    await palette(page).locator('.command-palette-input').fill('주간 회고')
    await page.keyboard.press('Enter')
    await expect(palette(page)).toHaveCount(0)
    await expect
      .poll(async () => (await readSavedContent(page, docId)).content)
      .not.toBe('본문\n')

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+z')

    await expect.poll(async () => (await readSavedContent(page, docId)).content).toBe('본문\n')
  })
})

test.describe('F-2022 A6 줄 가운데서 넣기', () => {
  test('가나다라 줄 가운데 — 줄이 쪼개지지 않고 빈 줄 뒤에 넣는다', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await openApp(page)
    const docId = await importMarkdown(page, { content: '가나다라\n' })
    const line = page.locator('.cm-line', { hasText: '가나다라' })
    await line.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight') // '가나' 뒤

    await page.keyboard.press('Control+p')
    await page.keyboard.press('Enter')
    await palette(page).locator('.command-palette-input').fill('버그')
    await page.keyboard.press('Enter')

    await expect.poll(async () => (await readSavedContent(page, docId)).content).toBe(
      '가나다라\n\n## 버그 보고\n\n- 환경:\n- 기대한 동작:\n- 실제 동작:\n\n### 재현 순서\n\n1. \n',
    )
  })
})

test.describe('F-2022 A7 프론트매터 합치기', () => {
  test('일일 노트 — 없는 키만 합치고 본문 뒤에, 되돌리기 1번으로 원래대로', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await openApp(page)
    const docId = await importMarkdown(page, { content: '---\ntags: 기존\n---\n\n본문\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')

    await page.keyboard.press('Control+p')
    await page.keyboard.press('Enter')
    await palette(page).locator('.command-palette-input').fill('일일')
    await page.keyboard.press('Enter')

    await expect.poll(async () => (await readSavedContent(page, docId)).content).toBe(
      '---\ntags: 기존\ndate: 2026-09-23\n---\n\n본문\n\n## 2026-09-23\n\n### 한 일\n\n- \n\n### 할 일\n\n- [ ] ',
    )

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await readSavedContent(page, docId)).content).toBe('---\ntags: 기존\n---\n\n본문\n')
  })
})

test.describe('F-2022 A8 사용자 템플릿', () => {
  test('템플릿 폴더 문서가 사용자 템플릿으로 뜨고, 대상 문서 제목으로 치환된다', async ({ page }) => {
    await openApp(page)
    await newTopFolder(page, '템플릿')
    await newDocInFolder(page, '템플릿')
    await fillTitle(page, '주간 보고')
    await page.locator('.cm-content').click()
    await page.keyboard.type('## {{title}}\n\n- ')
    await moveCurrentDocToFolder(page, '템플릿') // 이미 그 폴더 안이면 무해하게 같은 폴더로

    await newTopDoc(page)
    await fillTitle(page, '팀 회의')
    await page.locator('.cm-content').click()

    await page.keyboard.press('Control+p')
    await page.keyboard.press('Enter')

    const options = paletteOptions(page)
    await expect(options.first()).toHaveText(/주간 보고/)
    await expect(options.first().locator('.command-palette-item-detail')).toHaveText('템플릿')
    await expect(palette(page).locator('.command-palette-hint')).toHaveCount(0)

    await options.first().click()
    // 대상 문서("팀 회의")는 새로 만든 문서라 기본 줄바꿈이 CRLF 다(App.tsx createNewDoc) — 저장된 원문은 그대로 CRLF
    await expect.poll(async () => (await readSavedContent(page)).content).toBe('## 팀 회의\r\n\r\n- ')
  })
})

test.describe('F-2022 A9 우클릭으로 열기·닫기', () => {
  test('편집 모드 본문 우클릭 — 마지막 항목 명령 팔레트…, 누르면 팔레트, Esc 로 에디터 포커스', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문 줄\n' })
    const line = page.locator('.cm-line', { hasText: '본문 줄' })
    const box = await line.boundingBox()
    await page.mouse.click(box.x + 5, box.y + box.height / 2, { button: 'right' })

    const menuItems = page.locator('.context-menu-root [role="menuitem"]')
    const last = menuItems.last()
    await expect(last).toHaveText(/^명령 팔레트…/)
    await expect(last).toHaveText(/Ctrl\+P/)

    await last.click()
    await expect(page.locator('.context-menu-root')).toHaveCount(0)
    await expect(palette(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(palette(page)).toHaveCount(0)
    const focused = await page.evaluate(() => document.activeElement?.closest('.cm-content') != null)
    expect(focused).toBe(true)
  })
})

test.describe('F-2022 A10 표 칸에서', () => {
  test('칸 편집 중 우클릭 → 명령 팔레트… → 템플릿 삽입 — 표 뒤에 들어가고 표 원문 불변', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await openApp(page)
    await importMarkdown(page, { content: '표\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n' })
    const wrap = page.locator('.md-table-widget')
    const headerCell = wrap.locator('th').first()
    await headerCell.click()
    const cellLine = page.locator('.md-table-cell-editing .cm-line').first()
    const box = await cellLine.boundingBox()
    await page.mouse.click(box.x + 2, box.y + box.height / 2, { button: 'right' })

    const menuItems = page.locator('.context-menu-root [role="menuitem"]')
    await menuItems.last().click()
    await expect(palette(page)).toBeVisible()
    await page.keyboard.press('Enter')
    await palette(page).locator('.command-palette-input').fill('버그')
    await page.keyboard.press('Enter')

    await expect(page.locator('.md-table-widget')).toHaveCount(1)
    await expect(wrap.locator('td').nth(1)).toHaveText('2')
    await expect.poll(async () => (await readSavedContent(page)).content).toContain(
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n## 버그 보고',
    )
  })
})

test.describe('F-2022 A11 제목에서 열어도 에디터로', () => {
  test('제목 입력에서 Ctrl+P → Enter → Enter — 포커스가 에디터', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await page.locator('.doc-title').click()
    await page.keyboard.press('Control+p')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter') // 첫 템플릿(회의록)

    await expect(palette(page)).toHaveCount(0)
    await expect.poll(async () => {
      const focused = await page.evaluate(() => document.activeElement?.closest('.cm-content') != null)
      return focused
    }).toBe(true)
  })
})

test.describe('F-2022 A12 키보드', () => {
  test('ArrowUp/ArrowDown 순환, 빈 입력 Backspace 로 1단계 복귀', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+p')

    await page.keyboard.press('ArrowUp') // nextResultIndex(0,2,'ArrowUp') = 1
    await expect(paletteOptions(page).nth(1)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowDown') // nextResultIndex(1,2,'ArrowDown') = 0
    await expect(paletteOptions(page).nth(0)).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('Enter') // 템플릿 삽입 2단계로
    await expect(palette(page).locator('h2')).toHaveText('템플릿 삽입')
    await page.keyboard.press('Backspace')
    await expect(palette(page).locator('h2')).toHaveText('명령 팔레트')
    await expect(palette(page).locator('.command-palette-input')).toHaveValue('')
    await expect(paletteOptions(page).nth(0)).toHaveAttribute('aria-selected', 'true')
    await expect(paletteOptions(page).nth(0)).toHaveText(/템플릿 삽입/)
  })
})

test.describe('F-2022 A13 보기 모드', () => {
  test('Ctrl+P → Enter — 옵션이 PDF 하나, 인쇄 호출', async ({ page }) => {
    await stubPrint(page)
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await setViewMode(page, 'view')

    await page.keyboard.press('Control+p')
    await expect(paletteOptions(page)).toHaveCount(1)
    await expect(paletteOptions(page).first()).toHaveText(/PDF/)
    await page.keyboard.press('Enter')

    await expect.poll(() => printCallCount(page)).toBe(1)
    await expect(palette(page)).toHaveCount(0)
  })
})

test.describe('F-2022 A14 읽기 전용', () => {
  test('보기 권한 문서 — 템플릿 삽입 없음, PDF 있음', async ({ page }) => {
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
    await page.keyboard.press('Control+p')

    await expect(palette(page)).toBeVisible()
    const texts = await paletteOptions(page).allTextContents()
    expect(texts.some((t) => t.includes('템플릿 삽입'))).toBe(false)
    expect(texts.some((t) => t.includes('PDF'))).toBe(true)
  })
})

test.describe('F-2022 A15 홈에서', () => {
  test('빈 옵션, 인쇄 호출 없음', async ({ page }) => {
    await stubPrint(page)
    await openAppHome(page)

    await page.keyboard.press('Control+p')

    await expect(palette(page)).toBeVisible()
    await expect(paletteOptions(page)).toHaveCount(0)
    await expect(palette(page).locator('.command-palette-status')).toHaveText('지금 쓸 수 있는 명령이 없습니다')
    expect(await printCallCount(page)).toBe(0)
  })
})

test.describe('F-2022 A16 겹친 대화상자', () => {
  test('설정 열린 채 Ctrl+P 무시, 팔레트 연 채 Ctrl+P 는 입력칸 전체 선택', async ({ page }) => {
    await stubPrint(page)
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })

    await page.getByRole('button', { name: '설정', exact: true }).click()
    await expect(page.locator('.dialog[open]')).toBeVisible()
    await page.keyboard.press('Control+p')
    await expect(palette(page)).toHaveCount(0)
    expect(await printCallCount(page)).toBe(0)
    await page.keyboard.press('Escape')

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+p')
    await palette(page).locator('.command-palette-input').fill('템플')
    await page.keyboard.press('Control+p')

    const selection = await palette(page).locator('.command-palette-input').evaluate((el) => ({
      start: el.selectionStart,
      end: el.selectionEnd,
    }))
    expect(selection.start).toBe(0)
    expect(selection.end).toBe(2)
  })
})

test.describe('F-2022 A17 2단계 0개', () => {
  test('없는이름 — 맞는 템플릿이 없습니다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+p')
    await page.keyboard.press('Enter')
    await palette(page).locator('.command-palette-input').fill('없는이름')

    await expect(paletteOptions(page)).toHaveCount(0)
    await expect(palette(page).locator('.command-palette-status')).toHaveText('맞는 템플릿이 없습니다')
  })
})

test.describe('F-2022 A18 읽기 실패', () => {
  test('IndexedDB 레코드가 지워진 사용자 템플릿 — error 알림, 본문 불변, 팔레트 닫힘', async ({ page }) => {
    await openApp(page)
    await newTopFolder(page, '템플릿')
    await newDocInFolder(page, '템플릿')
    await fillTitle(page, '주간 보고')
    const templateDocId = await page.evaluate(() => {
      const m = /^#\/d\/(.+)$/.exec(location.hash)
      return m ? m[1] : null
    })

    await newTopDoc(page)
    await fillTitle(page, '본 문서')
    await page.locator('.cm-content').click()
    await page.keyboard.type('본문')
    const docId = await page.evaluate(() => {
      const m = /^#\/d\/(.+)$/.exec(location.hash)
      return m ? m[1] : null
    })
    await readSavedContent(page, docId) // 저장 대기

    await page.evaluate(
      (id) =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open('md-docs')
          req.onerror = () => reject(req.error)
          req.onsuccess = () => {
            const db = req.result
            const tx = db.transaction('docs', 'readwrite')
            tx.objectStore('docs').delete(id)
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
          }
        }),
      templateDocId,
    )

    await page.keyboard.press('Control+p')
    await page.keyboard.press('Enter')
    await palette(page).locator('.command-palette-input').fill('주간 보고')
    await page.keyboard.press('Enter')

    await expect(page.locator('.notice--error .notice-message')).toHaveText('템플릿을 읽지 못했습니다.')
    await expect(palette(page)).toHaveCount(0)
    await expect.poll(async () => (await readSavedContent(page, docId)).content).toBe('본문')
  })
})
