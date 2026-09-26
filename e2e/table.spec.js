// 표 위젯 — 버튼 위치, 가로 스크롤, 칸 표시, 편집 도중 손실 회귀 (F-150.md 3.3)
import { test, expect } from '@playwright/test'
import {
  openApp,
  importMarkdown,
  readSavedContent,
  setViewMode,
  rectOf,
  fakeImeCompose,
  fakeImeCommit,
} from './helpers.js'

// 문서 첫 줄에 표를 바로 두지 않는다 — 가져오기 직후 커서가 문서 맨 앞(0)에 있는데,
// 그 자리가 표 원문 범위 안이면 F-139 3.1 규칙으로 표가 원문(위젯 아님)으로 보인다.
// 앞에 줄 하나를 둬 커서가 "표 앞 줄"에 있게 한다(F-139 3.1 "표 앞 줄 → 위젯 있음")
const LEAD = '표\n\n'
// 머리 행 + 데이터 2행 = tr 3개(F-140 A13·A14 가 "마지막 행" 을 가리키는 데 쓴다)
const NARROW_TABLE = `${LEAD}| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n`

// 칸 안에 이미 <br> 이 든 표 (F-162 A3·A4 용)
const BR_TABLE = `${LEAD}| a | b |\n| --- | --- |\n| x<br>y | 2 |\n| 3 | 4 |\n`

function wideTable(cols) {
  const head = `| ${Array.from({ length: cols }, (_, i) => `h${i}`).join(' | ')} |`
  const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
  const row = `| ${Array.from({ length: cols }, (_, i) => `v${i}`).join(' | ')} |`
  return `${LEAD}${head}\n${sep}\n${row}\n`
}

test.describe('F-140 표 추가 버튼 위치와 칸 인라인 표시', () => {
  // F-140 A2(버튼 위치)·A11(칸 크기 불변)·A13(빈 칸 높이)은 시각 값이라 e2e 에서 뺐다 — specs/human-checks.md (2026-09-25 e2e 경량화)

  // 좁은 표·20열 표 두 번 돌던 것을 20열 하나로 줄였다. 툴팁 위치(±1px)는 시각 값이라 뺐다
  test('F-140 A3 20열 표는 편집 영역에 가로 스크롤을 만들지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: wideTable(20) })
    const scroller = page.locator('.cm-scroller')
    const wrap = page.locator('.md-table-widget')
    await wrap.hover()
    await wrap.locator('.md-table-add-col').focus()
    const sizes = await scroller.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
    expect(sizes.scrollWidth).toBe(sizes.clientWidth)
  })

  test('F-140 A4 넓은 표를 가로 스크롤해도 버튼이 보이는 영역 안에 남는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: wideTable(20) })
    const wrap = page.locator('.md-table-widget')
    const scroll = wrap.locator('.md-table-scroll')
    const scroller = page.locator('.cm-scroller')

    for (const fraction of [0, 0.5, 1]) {
      await scroll.evaluate((el, f) => {
        el.scrollLeft = (el.scrollWidth - el.clientWidth) * f
      }, fraction)
      await wrap.hover()
      const colRect = await rectOf(wrap.locator('.md-table-add-col'))
      const rowRect = await rectOf(wrap.locator('.md-table-add-row'))
      const scrollerRect = await rectOf(scroller)
      expect(colRect.right).toBeLessThanOrEqual(scrollerRect.right + 1)
      expect(colRect.left).toBeGreaterThanOrEqual(scrollerRect.left - 1)
      expect(rowRect.left).toBeGreaterThanOrEqual(scrollerRect.left - 1)
      expect(rowRect.right).toBeLessThanOrEqual(scrollerRect.right + 1)
    }
  })

  test('F-140 A6 원문 보존 — 편집하지 않은 칸은 바이트가 그대로다', async ({ page }) => {
    const content = `${LEAD}| **굵게** | [링크](https://example.com) |\n| --- | --- |\n| \`a*b\` | [[없는 문서]] |\n`
    await openApp(page)
    const docId = await importMarkdown(page, { content })
    const wrap = page.locator('.md-table-widget')
    const cells = wrap.locator('td, th')
    // 서식 표시(기호 없음) 확인
    // 머리 행(th): [0]=굵게, [1]=링크. 데이터 행(td): [2]=코드, [3]=위키링크
    await expect(cells.nth(0)).toHaveText('굵게')
    await expect(cells.nth(0).locator('.md-strong')).toBeVisible()
    await expect(cells.nth(1)).toHaveText('링크')

    // 링크 클릭 시 새 탭이 열리지 않고 칸 편집이 시작된다
    let opened = false
    page.once('popup', () => {
      opened = true
    })
    await cells.nth(1).click()
    await expect(wrap.locator('.md-table-cell-editing')).toHaveCount(1)
    await page.keyboard.press('Escape')
    expect(opened).toBe(false)

    // 다른 칸(코드)을 편집해도 첫 칸은 그대로다
    await cells.nth(2).click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await page.keyboard.press('Escape')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('**굵게**')
    expect(doc.content).toContain('[링크](https://example.com)')
  })

  test('F-140 A14 마지막 행에서 Enter — 글자 있으면 행 추가, 비어 있으면 표 밖으로', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: NARROW_TABLE })
    const table = page.locator('.md-table-widget table')

    // 3행 표: 마지막 행(2번째, 0-index) 2열 편집 후 Enter
    await table.locator('tr').nth(2).locator('td').nth(1).click()
    await page.keyboard.type('x')
    await page.keyboard.press('Enter')
    await expect(table.locator('tr')).toHaveCount(4)
    // 같은 열(1) 편집 중이어야 한다
    await expect(page.locator('.md-table-cell-editing[data-col="1"]')).toHaveCount(1)

    // 아무것도 안 치고 Enter — 빈 행이므로 행 추가 없이 표를 빠져나간다
    await page.keyboard.press('Enter')
    await expect(table.locator('tr')).toHaveCount(4)

    // Ctrl+Z 한 번으로 행 추가 취소
    await page.keyboard.press('Control+z')
    await expect(table.locator('tr')).toHaveCount(3)

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toMatch(/4x|x4/)
  })
})

test.describe('F-124 A2d 위젯 아래 줄 클릭 위치', () => {
  test('코드블록·표 아래 줄을 클릭하면 그 줄에 커서가 놓인다', async ({ page }) => {
    const content = [
      '```js',
      'x'.repeat(300),
      '```',
      '아래줄A',
      '',
      NARROW_TABLE.trimEnd(),
      '아래줄B',
      '',
    ].join('\n')
    await openApp(page)
    const docId = await importMarkdown(page, { content })

    // 코드블록 바로 아래 줄 클릭 후 타이핑 — 그 줄에 글자가 들어가야 한다
    const belowCode = page.getByText('아래줄A', { exact: true })
    await belowCode.click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')

    const belowTable = page.getByText('아래줄B', { exact: true })
    await belowTable.click()
    await page.keyboard.press('End')
    await page.keyboard.type('?')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('아래줄A!')
    expect(doc.content).toContain('아래줄B?')
  })
})

test.describe('F-139 표를 치는 도중 내용 손실', () => {
  test('F-139 A2 새 줄에서 표를 이어 쳐도 세 줄이 그대로 남는다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('| a | b |\n| --- | --- |\n| 1 | 2 |')

    await setViewMode(page, 'raw')
    const doc = await readSavedContent(page, docId)
    expect(doc.content.replace(/\r\n/g, '\n')).toContain('| a | b |\n| --- | --- |\n| 1 | 2 |')
  })
})

test.describe('F-138 표 칸 역슬래시 왕복', () => {
  test('F-138 A2 칸 끝에 글자를 입력해도 역슬래시가 유지된다', async ({ page }) => {
    const content = `${LEAD}| C:\\Users | a\\*b |\n| --- | --- |\n| x | y |\n`
    await openApp(page)
    const docId = await importMarkdown(page, { content })
    const cell = page.locator('.md-table-widget td, .md-table-widget th').first()
    await cell.click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await page.keyboard.press('Escape')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('C:\\Users!')
    // 표 열 수(칸 개수)가 그대로 — 원문이 3칸씩 유지된다
    expect((doc.content.match(/\|/g) ?? []).length).toBe((content.match(/\|/g) ?? []).length)
  })
})

test.describe('F-161 표 칸 입력 결함', () => {
  test('F-161 A1 칸 안에서 실제 키로 띄어쓰기가 그대로 들어간다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: NARROW_TABLE })
    const wrap = page.locator('.md-table-widget')
    const cell = wrap.locator('td, th').nth(2) // 2행 1열, "1"

    await cell.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Home')
    await page.keyboard.type('a b c')
    await page.keyboard.press('Escape')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('| a b c | 2 |')
    // 다른 줄은 바이트가 그대로다
    expect(doc.content).toContain('| a | b |')
    expect(doc.content).toContain('| --- | --- |')
    expect(doc.content).toContain('| 3 | 4 |')
  })

  test('F-161 A2 칸에 키보드로 포커스한 뒤 Enter·Space 로 편집을 시작한다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: NARROW_TABLE })
    const wrap = page.locator('.md-table-widget')

    // Tab 으로 포커스한 뒤 Enter — 그 칸 편집 시작
    const cellA = wrap.locator('td, th').nth(0) // 머리 행 "a"
    await cellA.focus()
    await page.keyboard.press('Enter')
    await expect(wrap.locator('.md-table-cell-editing[data-row="0"][data-col="0"]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(wrap.locator('.md-table-cell-editing')).toHaveCount(0)

    // 다른 칸에 포커스한 뒤 Space — 그 칸 편집 시작, Space 가 글자로 들어가지 않는다
    const cellB = wrap.locator('td, th').nth(2) // "1"
    await cellB.focus()
    await page.keyboard.press(' ')
    await expect(wrap.locator('.md-table-cell-editing[data-row="1"][data-col="0"]')).toHaveCount(1)
    await page.keyboard.press('Escape')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('| 1 | 2 |') // Space 가 칸에 들어가지 않아 "1" 그대로
  })

  test('F-161 A3 조합 확정 뒤 스페이스로 이어 조합해도 칸에 그대로 남는다', async ({ page }) => {
    const content = `${LEAD}| a | b |\n| --- | --- |\n|  | y |\n`
    await openApp(page)
    const docId = await importMarkdown(page, { content })
    const wrap = page.locator('.md-table-widget')
    const cell = wrap.locator('td, th').nth(2) // 빈 칸

    await cell.click()
    const cdp1 = await fakeImeCompose(page, '한')
    await fakeImeCommit(cdp1, '한')
    await page.keyboard.press(' ')
    const cdp2 = await fakeImeCompose(page, '글')
    await fakeImeCommit(cdp2, '글')
    await page.keyboard.press('Escape')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('| 한 글 | y |')
  })

  test('F-161 A4 조합 중에는 Tab 이 칸을 이동시키지 않는다', async ({ page }) => {
    const content = `${LEAD}| a | b |\n| --- | --- |\n|  | y |\n`
    await openApp(page)
    const docId = await importMarkdown(page, { content })
    const wrap = page.locator('.md-table-widget')
    const cell = wrap.locator('td, th').nth(2) // 빈 칸, row=1 col=0

    await cell.click()
    await expect(wrap.locator('.md-table-cell-editing[data-row="1"][data-col="0"]')).toHaveCount(1)

    const cdp = await fakeImeCompose(page, '한')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(50)
    // 다른 칸(row=1 col=1)으로 옮겨가지 않았어야 한다
    await expect(wrap.locator('.md-table-cell-editing[data-row="1"][data-col="1"]')).toHaveCount(0)

    await fakeImeCommit(cdp, '한')
    await page.keyboard.press('Escape')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('한')
    expect(doc.content).toContain('| y |')
  })

  test('F-161 A5 표를 줄 단위로 한글 포함해 쳐도 세 줄이 그대로 남는다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')

    await page.keyboard.type('| ')
    const cdp1 = await fakeImeCompose(page, '이름')
    await fakeImeCommit(cdp1, '이름')
    await page.keyboard.type(' | ')
    const cdp2 = await fakeImeCompose(page, '값')
    await fakeImeCommit(cdp2, '값')
    await page.keyboard.type(' |\n| --- | --- |\n| ')
    const cdp3 = await fakeImeCompose(page, '가')
    await fakeImeCommit(cdp3, '가')
    await page.keyboard.type(' | ')
    const cdp4 = await fakeImeCompose(page, '나')
    await fakeImeCommit(cdp4, '나')
    await page.keyboard.type(' |')

    await setViewMode(page, 'raw')
    const doc = await readSavedContent(page, docId)
    expect(doc.content.replace(/\r\n/g, '\n')).toContain('| 이름 | 값 |\n| --- | --- |\n| 가 | 나 |')
  })

  test('F-161 A6 회귀 — 방향키·Tab 으로 칸 사이를 옮긴다 (F-125 2.3)', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: NARROW_TABLE })
    const wrap = page.locator('.md-table-widget')

    await wrap.locator('td, th').nth(0).click() // row0 col0
    await page.keyboard.press('Tab')
    await expect(wrap.locator('.md-table-cell-editing[data-row="0"][data-col="1"]')).toHaveCount(1)

    await page.keyboard.press('ArrowDown')
    await expect(wrap.locator('.md-table-cell-editing[data-row="1"][data-col="1"]')).toHaveCount(1)

    await page.keyboard.press('ArrowLeft')
    await expect(wrap.locator('.md-table-cell-editing[data-row="1"][data-col="0"]')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(wrap.locator('.md-table-cell-editing')).toHaveCount(0)
  })
})

test.describe('F-162 표 칸 안 줄바꿈 (Alt+Enter → <br>)', () => {
  test('F-162 A2 Alt+Enter 로 칸에 <br> 를 넣는다 — 원문 반영과 되돌리기', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: NARROW_TABLE })
    const wrap = page.locator('.md-table-widget')
    const cell = wrap.locator('td, th').nth(2) // row1 col0, "1"

    await cell.click()
    await page.keyboard.press('End')
    await page.keyboard.type('a')
    await page.keyboard.press('Alt+Enter')
    // 편집 중인 칸은 원문 그대로 <br> 글자가 보인다 (F-162 2.2)
    await expect(wrap.locator('.md-table-cell-editing .cm-content')).toHaveText('1a<br>')

    // Ctrl+Z 한 번 — <br> 삽입만 되돌아가고 앞서 친 a 는 남는다(F-162 2.1)
    await page.keyboard.press('Control+z')
    let doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('| 1a | 2 |')

    // 이어서 다시 Alt+Enter 로 넣고 b 를 이어 쳐 "1a<br>b" 를 만든다
    await cell.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Alt+Enter')
    await page.keyboard.type('b')
    await page.keyboard.press('Escape')

    doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('| 1a<br>b | 2 |')
    // 다른 줄은 바이트가 그대로다
    expect(doc.content).toContain('| a | b |')
    expect(doc.content).toContain('| --- | --- |')
    expect(doc.content).toContain('| 3 | 4 |')
  })

  // 칸 높이가 늘어나는지(1.5배)는 시각 값이라 뺐다 — <br> 요소가 그려지는지만 본다
  test('F-162 A3 편집 중이 아닌 칸의 <br> 은 줄바꿈으로 보인다', async ({ page }) => {
    const content = `${BR_TABLE}아래줄\n`
    await openApp(page)
    const docId = await importMarkdown(page, { content })
    const wrap = page.locator('.md-table-widget')
    const rows = wrap.locator('table tr')
    const brCell = rows.nth(1).locator('td').first() // "x<br>y"

    await expect(brCell.locator('br')).toHaveCount(1)

    // 표 아래 줄 클릭 위치가 F-124 3.4 규칙대로 맞는다(F-124 A2d 방법)
    const belowTable = page.getByText('아래줄', { exact: true })
    await belowTable.click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('아래줄!')
  })

  test('F-162 A4 보기 모드 — 표 칸의 <br> 은 줄바꿈, 문단의 <br> 은 글자', async ({ page }) => {
    const content = `${BR_TABLE}\n문단 x<br>y\n`
    await openApp(page)
    await importMarkdown(page, { content })
    await setViewMode(page, 'view')

    const cell = page.locator('.viewer table td').first() // "x<br>y"
    await expect(cell.locator('br')).toHaveCount(1)

    const paragraph = page.locator('.viewer p', { hasText: '문단' })
    await expect(paragraph).toContainText('x<br>y')
    await expect(paragraph.locator('br')).toHaveCount(0)
  })
})

// 머리 행 + 본문 4행 (F-164 A1 "본문 4행 표")
// F-164 A1(행 바탕 = 문서 칸 바탕, 세 테마)·A3(칸 편집 중 강조 숨김)은 시각 값이라 e2e 에서 뺐다 — specs/human-checks.md (2026-09-25 e2e 경량화)

// 머리 + 본문 2행, 3열 (F-165 드래그 범위 선택용)
const GRID_TABLE = `${LEAD}| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n`

// cellA 에서 마우스를 누른 채 cellB 로 끌어 뗀다 (F-165 2.1)
async function dragSelect(cellA, cellB) {
  const boxA = await cellA.boundingBox()
  const boxB = await cellB.boundingBox()
  const page = cellA.page()
  await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2)
  await page.mouse.down()
  await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2, { steps: 8 })
  await page.mouse.up()
}

function cellAt(table, row, col) {
  return table.locator('tr').nth(row).locator('td, th').nth(col)
}

test.describe('F-165 표 칸 범위 선택과 행·열 삭제', () => {
  // 사각형이 두 칸을 감싸는 좌표(±2px)는 시각 값이라 뺐다
  test('F-165 A2 끌기로 범위를 선택하면 사각형이 보이고 하위 에디터는 없다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: GRID_TABLE })
    const wrap = page.locator('.md-table-widget')
    const table = wrap.locator('table')
    const from = cellAt(table, 1, 0) // "1"
    const to = cellAt(table, 2, 1) // "5"

    await dragSelect(from, to)

    const highlight = wrap.locator('.md-table-cell-highlight')
    await expect(highlight).toBeVisible()
    await expect(wrap.locator('.md-table-cell-editing')).toHaveCount(0)
  })

  test('F-165 A3 끌지 않고 떼면 그 칸 편집이 시작된다(회귀, F-125 A3)', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: GRID_TABLE })
    const wrap = page.locator('.md-table-widget')
    const table = wrap.locator('table')
    const cell = cellAt(table, 1, 1) // "2"

    await dragSelect(cell, cell) // 같은 칸에서 누르고 뗀다 — 끌기 아님

    await expect(wrap.locator('.md-table-cell-editing[data-row="1"][data-col="1"]')).toHaveCount(1)
    await expect(wrap.locator('.md-table-cell-highlight')).not.toBeVisible()
  })

  test('F-165 A4 열 전체를 끌어 선택한 뒤 Delete 로 그 열을 지운다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: GRID_TABLE })
    const wrap = page.locator('.md-table-widget')
    const table = wrap.locator('table')

    await dragSelect(cellAt(table, 0, 1), cellAt(table, 2, 1)) // 머리~마지막 행, 가운데 열
    await page.keyboard.press('Delete')

    const doc = await readSavedContent(page, docId)
    expect(doc.content.replace(/\r\n/g, '\n')).toContain('| a | c |\n| --- | --- |\n| 1 | 3 |\n| 4 | 6 |')

    // 삭제 뒤 포커스가 주 에디터로 돌아와 있어야 Ctrl+Z 한 번으로 되돌아간다
    await page.keyboard.press('Control+z')
    const undone = await readSavedContent(page, docId)
    expect(undone.content.replace(/\r\n/g, '\n')).toBe(GRID_TABLE)
  })

  test('F-165 A5 본문 행 전체를 끌어 선택한 뒤 Backspace 로 그 행을 지운다, 커서는 표 다음 줄로', async ({ page }) => {
    // 표와 "이후문단" 사이에 빈 줄이 있어야 표가 거기서 끝난다(빈 줄 없이 붙으면 그 줄도 표의 한 본문 행으로 읽힌다 — F-124 A2d 픽스처와 같은 이유)
    const content = `${GRID_TABLE}\n이후문단\n`
    await openApp(page)
    const docId = await importMarkdown(page, { content })
    const wrap = page.locator('.md-table-widget')
    const table = wrap.locator('table')

    await dragSelect(cellAt(table, 2, 0), cellAt(table, 2, 2)) // 본문 2행 전체("4 | 5 | 6")
    await page.keyboard.press('Backspace')

    await expect(table.locator('tr')).toHaveCount(2) // 머리 + 본문 1행만 남는다
    await page.keyboard.type('X')

    // 커서는 "표 다음 줄"(표와 "이후문단" 사이의 빈 줄) 시작에 있다 — 그 줄에 친 글자가 들어간다
    const doc = await readSavedContent(page, docId)
    expect(doc.content.replace(/\r\n/g, '\n')).toContain('| 1 | 2 | 3 |\nX\n이후문단')
  })

  test('F-165 A6 머리+본문 행을 함께 선택해 Delete — 머리는 비우고 본문 행은 지운다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: GRID_TABLE })
    const wrap = page.locator('.md-table-widget')
    const table = wrap.locator('table')

    await dragSelect(cellAt(table, 0, 0), cellAt(table, 1, 2)) // 머리 전체 + 본문 1행 전체
    await page.keyboard.press('Delete')

    await expect(wrap).toHaveCount(1) // 위젯 그대로(표 구조 유지)
    await expect(table.locator('tr')).toHaveCount(2) // 머리 + 본문 1행("4|5|6")만 남는다
    const headerCells = table.locator('tr').nth(0).locator('th')
    await expect(headerCells.nth(0)).toHaveText('')
    await expect(headerCells.nth(1)).toHaveText('')
    await expect(headerCells.nth(2)).toHaveText('')

    const doc = await readSavedContent(page, docId)
    expect(doc.content.replace(/\r\n/g, '\n')).toContain('| 4 | 5 | 6 |')
  })

  test('F-165 A7 모든 칸을 선택해 Delete — 표가 사라지고 빈 줄 하나만 남는다', async ({ page }) => {
    const content = `앞줄\n\n${GRID_TABLE.slice(LEAD.length)}\n뒤줄\n`
    await openApp(page)
    const docId = await importMarkdown(page, { content })
    const wrap = page.locator('.md-table-widget')
    const table = wrap.locator('table')

    await dragSelect(cellAt(table, 0, 0), cellAt(table, 2, 2))
    await page.keyboard.press('Delete')

    await expect(page.locator('.md-table-widget')).toHaveCount(0)
    const doc = await readSavedContent(page, docId)
    expect(doc.content.replace(/\r\n/g, '\n')).toContain('앞줄\n\n\n\n뒤줄')
  })

  test('F-165 A8 일부 칸만 선택해 Delete — 내용만 비우고 선택은 유지된다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: GRID_TABLE })
    const wrap = page.locator('.md-table-widget')
    const table = wrap.locator('table')

    await dragSelect(cellAt(table, 1, 0), cellAt(table, 1, 1)) // 본문 1행의 두 칸만("1","2")
    await page.keyboard.press('Delete')

    await expect(wrap.locator('.md-table-cell-highlight')).toBeVisible() // 선택 유지

    const doc = await readSavedContent(page, docId)
    expect(doc.content.replace(/\r\n/g, '\n')).toContain('|  |  | 3 |')
  })

  test('F-165 A9 Esc 와 표 밖 클릭으로 범위 선택을 해제한다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: GRID_TABLE })
    const wrap = page.locator('.md-table-widget')
    const table = wrap.locator('table')
    const highlight = wrap.locator('.md-table-cell-highlight')

    await dragSelect(cellAt(table, 0, 0), cellAt(table, 1, 1))
    await expect(highlight).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(highlight).not.toBeVisible()

    await dragSelect(cellAt(table, 0, 0), cellAt(table, 1, 1))
    await expect(highlight).toBeVisible()
    await page.getByText('표', { exact: true }).click() // LEAD 문단(표 밖)
    await expect(highlight).not.toBeVisible()
  })
})

// F-171: 표 행·열 추가 때 화면 튐. 표 앞뒤에 긴 여백을 둬 스크롤 여지를 만든다
function f171Pad(n) {
  return Array.from({ length: n }, (_, i) => `줄 ${i + 1}`).join('\n\n')
}
// 표 뒤 여백은 짧게 둔다 — Control+End 로 문서 끝까지 가면 CM6 가 끝 근처만 그리므로(가상화),
// 표가 끝에서 너무 멀면 위젯이 DOM 에 없어 locator 가 못 찾는다. "칸 아래 room" 은 앞쪽 여백
// 안으로 스크롤을 올려 만든다(f171PositionTable)
const F171_DOC = `${f171Pad(60)}\n\n표\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\n뒤 여백\n`

function f171WideTable(cols) {
  const head = `| ${Array.from({ length: cols }, (_, i) => `h${i}`).join(' | ')} |`
  const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
  const row = `| ${Array.from({ length: cols }, (_, i) => `v${i}`).join(' | ')} |`
  return `${LEAD}${head}\n${sep}\n${row}\n`
}

// 편집 영역(주 에디터) scrollTop — 칸 하위 에디터도 .cm-scroller 를 가지므로 첫 번째(가장 바깥) 것만 쓴다
async function mainScrollTop(page) {
  return page.locator('.cm-scroller').first().evaluate((el) => el.scrollTop)
}

// F-165 포커스 요소·범위 선택 포커스로 인한 네이티브 스크롤 보정(focusCellClamped)이 끝날 때까지 기다린다
async function waitScrollSettle(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))),
  )
  await page.waitForTimeout(50)
}

// 표 위젯이 렌더링될 만큼 문서 끝으로 이동한 뒤(가상화 대응), wrap 아래 끝을 scroller 아래 끝에서
// offsetFromBottom px 위에 오도록 마우스 휠로 스크롤한다(값이 크면 "칸이 다 보이는 경우", 작으면
// "벗어나는 경우") — 실제 사용자처럼 휠 이벤트로 스크롤한다. scrollTop 이 늘수록(휠을 아래로)
// 화면 위 내용은 위로 옮겨가므로(= wrap 아래 끝의 화면 y 는 줄어든다), 필요한 만큼 아래로
// 스크롤한 delta 는 "wrap 아래 끝 - scroller 아래 끝 + offsetFromBottom" 이다
async function f171PositionTable(page, offsetFromBottom) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  const table = page.locator('.md-table-widget table')
  await table.waitFor()
  const scroller = page.locator('.cm-scroller').first()
  const scRect = await rectOf(scroller)
  await page.mouse.move(scRect.x + scRect.width / 2, scRect.y + scRect.height / 2)
  const wrapRect = await rectOf(page.locator('.md-table-widget'))
  await page.mouse.wheel(0, wrapRect.bottom - scRect.bottom + offsetFromBottom)
  await waitScrollSettle(page)
  return table
}

test.describe('F-171 표 행·열 추가 때 화면 튐', () => {
  test('F-171 A2 칸이 이미 보이면 Enter·+ 행 추가 모두 scrollTop 을 바꾸지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: F171_DOC })
    const table = await f171PositionTable(page, 300) // 아래에 room 넉넉

    // 마지막 행 Enter 로 행 추가
    const before1 = await mainScrollTop(page)
    await table.locator('tr').last().locator('td').last().click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await waitScrollSettle(page)
    await expect(table.locator('tr')).toHaveCount(4)
    expect(Math.abs((await mainScrollTop(page)) - before1)).toBeLessThanOrEqual(1)
    await page.keyboard.press('Escape')

    // + 버튼으로 행 추가
    const before2 = await mainScrollTop(page)
    const wrap = page.locator('.md-table-widget')
    await wrap.hover()
    await wrap.locator('.md-table-add-row').click()
    await waitScrollSettle(page)
    await expect(table.locator('tr')).toHaveCount(5)
    expect(Math.abs((await mainScrollTop(page)) - before2)).toBeLessThanOrEqual(1)
  })

  test('F-171 A3 칸이 창 아래로 벗어나면 그 칸 아래 끝만 창 아래 끝에 맞춘다', async ({ page }) => {
    for (const method of ['enter', 'button']) {
      await openApp(page)
      await importMarkdown(page, { content: F171_DOC })
      const table = await f171PositionTable(page, 4) // 표 마지막 행이 창 아래 끝에 걸침

      if (method === 'enter') {
        await table.locator('tr').last().locator('td').last().click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
      } else {
        const wrap = page.locator('.md-table-widget')
        await wrap.hover()
        await wrap.locator('.md-table-add-row').click()
      }
      await waitScrollSettle(page)
      await expect(table.locator('tr')).toHaveCount(4)

      const newCell = table.locator('tr').last().locator('td').last()
      const cellRect = await rectOf(newCell)
      const scRect = await rectOf(page.locator('.cm-scroller').first())
      expect(Math.abs(cellRect.bottom - scRect.bottom)).toBeLessThanOrEqual(2)
      expect(cellRect.top).toBeGreaterThanOrEqual(scRect.top - 1)
    }
  })

  test('F-171 A4 행 추가를 5회 반복해도 매번 scrollTop 이 그대로다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: F171_DOC })
    const table = await f171PositionTable(page, 400) // 5행 추가할 room
    const wrap = page.locator('.md-table-widget')
    await wrap.hover()
    const rowBtn = wrap.locator('.md-table-add-row')

    for (let i = 0; i < 5; i++) {
      const before = await mainScrollTop(page)
      await rowBtn.click()
      await waitScrollSettle(page)
      const after = await mainScrollTop(page)
      expect(Math.abs(after - before)).toBeLessThanOrEqual(1)
    }
    await expect(table.locator('tr')).toHaveCount(8)
  })

  test('F-171 A5 열 추가·칸 이동(칸이 보이는 경우) 모두 scrollTop 을 바꾸지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: F171_DOC })
    const table = await f171PositionTable(page, 300)
    const wrap = page.locator('.md-table-widget')

    const before1 = await mainScrollTop(page)
    await wrap.hover()
    await wrap.locator('.md-table-add-col').click()
    await waitScrollSettle(page)
    expect(Math.abs((await mainScrollTop(page)) - before1)).toBeLessThanOrEqual(1)

    await table.locator('tr').nth(0).locator('th').first().click()
    for (const key of ['Tab', 'Enter', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      const before = await mainScrollTop(page)
      await page.keyboard.press(key)
      await waitScrollSettle(page)
      expect(Math.abs((await mainScrollTop(page)) - before)).toBeLessThanOrEqual(1)
    }
  })

  test('F-171 A6 가로 스크롤 — 열 추가로 새 칸이 보이고 세로 scrollTop 은 그대로다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: f171WideTable(12) })
    const wrap = page.locator('.md-table-widget')
    const scroll = wrap.locator('.md-table-scroll')
    await wrap.hover()

    const before = await mainScrollTop(page)
    await wrap.locator('.md-table-add-col').click()
    await waitScrollSettle(page)
    expect(Math.abs((await mainScrollTop(page)) - before)).toBeLessThanOrEqual(1)

    const newColCell = wrap.locator('table tr').first().locator('th').last()
    const cellRect = await rectOf(newColCell)
    const scrollRect = await rectOf(scroll)
    expect(cellRect.left).toBeGreaterThanOrEqual(scrollRect.left - 1)
    expect(cellRect.right).toBeLessThanOrEqual(scrollRect.right + 1)
  })
})
