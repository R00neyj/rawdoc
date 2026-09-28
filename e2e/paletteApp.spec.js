// 명령 팔레트 앱 명령 — 이동·문서·보기·내보내기 (specs/features/F-2054.md 11.2)
import { test, expect } from '@playwright/test'
import { openApp, openAppHome, importMarkdown, setPrefBeforeLoad } from './helpers.js'

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

// A1 준비 — 문서 하나를 열고 본문에 포커스한다 (11.2)
async function prepareDoc(page, content = '본문\n') {
  await openApp(page)
  await importMarkdown(page, { content })
  await page.locator('.cm-content').click()
}

async function runCommand(page, query) {
  await page.keyboard.press('Control+p')
  await palette(page).locator('.command-palette-input').fill(query)
  await page.keyboard.press('Enter')
}

test.describe('F-2054 A1 탐색·포커스', () => {
  test('설정 열고 닫으면 에디터로', async ({ page }) => {
    await prepareDoc(page)
    await runCommand(page, '>설정')

    await expect(palette(page)).toHaveCount(0)
    await expect(page.locator('dialog[open] h2')).toHaveText('설정')

    await page.keyboard.press('Escape')
    await expect(page.locator('dialog[open]')).toHaveCount(0)
    const focused = await page.evaluate(() => document.activeElement?.closest('.cm-content') != null)
    expect(focused).toBe(true)
  })
})

test.describe('F-2054 A2 탐색', () => {
  test('도움말 → 홈', async ({ page }) => {
    await prepareDoc(page)
    await runCommand(page, '>도움말')
    await expect(page.locator('.help-page-title')).toBeVisible()
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/help')

    await page.keyboard.press('Control+p')
    await palette(page).locator('.command-palette-input').fill('>')
    await expect(paletteOptions(page).filter({ hasText: '도움말 열기' })).toHaveCount(0)
    const home = paletteOptions(page).filter({ hasText: '홈으로' })
    await expect(home).toHaveCount(1)
    await palette(page).locator('.command-palette-input').fill('>홈으로')
    await page.keyboard.press('Enter')

    await expect(page.locator('.empty-state')).toBeVisible()
  })
})

test.describe('F-2054 A3 만들기 — 도움말에서 새 문서(6.4)', () => {
  test('세 방법 모두 도움말 화면이 겹치지 않는다', async ({ page }) => {
    await prepareDoc(page)

    // ① 팔레트 명령
    await runCommand(page, '>도움말')
    await expect(page.locator('.help-page-title')).toBeVisible()
    await runCommand(page, '>새 문서')
    await expect(page.locator('.main-column .content-area')).toHaveCount(1)
    await expect(page.locator('.main-column h1', { hasText: '도움말' })).toHaveCount(0)
    await expect(page.locator('.doc-title')).toBeFocused()

    // ② 사이드바 새 문서 버튼
    await runCommand(page, '>도움말')
    await expect(page.locator('.help-page-title')).toBeVisible()
    await page.getByRole('button', { name: '새 문서', exact: true }).click()
    await expect(page.locator('.doc-title')).toBeVisible()
    await expect(page.locator('.main-column .content-area')).toHaveCount(1)
    await expect(page.locator('.main-column h1', { hasText: '도움말' })).toHaveCount(0)

    // ③ .md 가져오기 파일 입력
    await runCommand(page, '>도움말')
    await expect(page.locator('.help-page-title')).toBeVisible()
    await page.locator('input[data-import="md"]').setInputFiles({
      name: '가져온 글.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 가\n', 'utf-8'),
    })
    await expect(page.locator('.main-column .content-area')).toHaveCount(1)
    await expect(page.locator('.main-column h1', { hasText: '도움말' })).toHaveCount(0)
  })
})

test.describe('F-2054 6.4 실패하면 도움말에 남는다', () => {
  test('가져온 파일이 0개면 도움말 화면과 #/help 가 그대로다', async ({ page }) => {
    await prepareDoc(page)
    await runCommand(page, '>도움말')
    await expect(page.locator('.help-page-title')).toBeVisible()

    await page.locator('input[data-import="md"]').setInputFiles({
      name: '깨진 글.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from([0x80, 0x81, 0x82]),
    })
    await expect(page.getByText('UTF-8 텍스트 파일이 아닙니다', { exact: false })).toBeVisible()
    await expect(page.locator('.help-page-title')).toBeVisible()
    expect(await page.evaluate(() => location.hash)).toBe('#/help')
  })

  test('새 문서 만들기가 실패하면 도움말 화면과 #/help 가 그대로다', async ({ page }) => {
    await prepareDoc(page)
    await runCommand(page, '>도움말')
    await expect(page.locator('.help-page-title')).toBeVisible()
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'docs') throw new DOMException('막힘', 'UnknownError')
        return put.apply(this, args)
      }
    })

    await page.getByRole('button', { name: '새 문서', exact: true }).click()
    await expect(page.getByText('새 문서를 만들지 못했습니다', { exact: false })).toBeVisible()
    await expect(page.locator('.help-page-title')).toBeVisible()
    expect(await page.evaluate(() => location.hash)).toBe('#/help')
  })
})

test.describe('F-2054 A4 지금 문서 — 삭제 확인(사용자 결정 2)', () => {
  test('취소하면 남고, 삭제하면 없어진다', async ({ page }) => {
    await openApp(page)
    await fillTitle(page, '남길 문서')
    await page.getByRole('button', { name: '새 문서', exact: true }).click()
    await fillTitle(page, '지울 문서')
    await page.locator('.cm-content').click()

    await runCommand(page, '>삭제')

    const dialog = page.locator('dialog[open]')
    await expect(dialog).toContainText('"지울 문서" 을(를) 삭제할까요? 되돌릴 수 없습니다.')
    await expect(dialog.getByRole('button', { name: '취소' })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(page.locator('.sidebar .doc-item-btn', { hasText: '지울 문서' })).toBeVisible()
    const focused = await page.evaluate(() => document.activeElement?.closest('.cm-content') != null)
    expect(focused).toBe(true)

    await runCommand(page, '>삭제')
    await page.locator('dialog[open]').getByRole('button', { name: '삭제', exact: true }).click()
    await expect(page.locator('.sidebar .doc-item-btn', { hasText: '지울 문서' })).toHaveCount(0)
  })
})

test.describe('F-2054 A5 만들기 — 가져오기 파일 창', () => {
  test('.md 가져오기 명령이 파일 선택 창을 연다', async ({ page }) => {
    await prepareDoc(page)
    await page.keyboard.press('Control+p')
    await palette(page).locator('.command-palette-input').fill('>.md 가져오기')

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 3000 }),
      page.keyboard.press('Enter'),
    ])
    await chooser.setFiles({ name: '가져온 글.md', mimeType: 'text/markdown', buffer: Buffer.from('# 가\n', 'utf-8') })

    await expect(page.locator('.sidebar .doc-item-btn', { hasText: '가져온 글' })).toBeVisible()
  })
})

test.describe('F-2054 A6 만들기 — 새 폴더 이름 칸', () => {
  test('넓은 창·레일 모두 이름 칸이 열린다', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await prepareDoc(page)

    await runCommand(page, '>새 폴더')
    const input1 = page.locator('.tree-rename-input')
    await expect(input1).toBeFocused()
    await expect(input1).toHaveValue('새 폴더')
    await input1.fill('업무')
    await input1.press('Enter')
    await expect(page.locator('.tree-row', { hasText: '업무' })).toBeVisible()

    // 레일(접힌 사이드바)에서도 같다
    await page.locator('.sidebar').getByRole('button', { name: '사이드바 접기', exact: true }).click()
    await runCommand(page, '>새 폴더')
    const input2 = page.locator('.tree-rename-input')
    await expect(input2).toBeFocused()
    await expect(input2).toHaveValue('새 폴더')
    await input2.fill('개인')
    await input2.press('Enter')
    await expect(page.locator('.tree-row', { hasText: '개인' })).toBeVisible()
  })

  test('좁은 창 + 저장된 접힘 설정에서도 이름 칸이 열린다', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 })
    await setPrefBeforeLoad(page, 'md.sidebar', 'collapsed')
    await prepareDoc(page)

    await runCommand(page, '>새 폴더')
    const input = page.locator('.tree-rename-input')
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('새 폴더')
  })
})

test.describe('F-2054 A7 보기 — 모드 전환', () => {
  test('원문 모드로 전환 뒤 포커스, 목록에서 빠진다', async ({ page }) => {
    await prepareDoc(page)
    await runCommand(page, '>원문')

    await expect(page.getByRole('button', { name: '원문 — 마크다운 기호 그대로 편집', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const focused = await page.evaluate(() => document.activeElement?.closest('.cm-content') != null)
    expect(focused).toBe(true)

    await page.keyboard.press('Control+p')
    await palette(page).locator('.command-palette-input').fill('>모드')
    const texts = await paletteOptions(page).allTextContents()
    expect(texts.some((t) => t.includes('원문 모드로 전환'))).toBe(false)
    expect(texts.some((t) => t.includes('편집 모드로 전환'))).toBe(true)
    expect(texts.some((t) => t.includes('보기 모드로 전환'))).toBe(true)
  })
})

test.describe('F-2054 A8 보기 — 테마 pick', () => {
  test('테마 바꾸기 2단계 → 다크', async ({ page }) => {
    await prepareDoc(page)
    await page.keyboard.press('Control+p')
    await palette(page).locator('.command-palette-input').fill('>테마')
    await page.keyboard.press('Enter')

    await expect(palette(page).locator('h2')).toHaveText('테마 바꾸기')
    const options = paletteOptions(page)
    await expect(options).toHaveCount(4)
    await expect(options.nth(0)).toHaveText(/시스템/)
    await expect(options.nth(0).locator('.command-palette-item-detail')).toHaveText('사용 중')

    await palette(page).locator('.command-palette-input').fill('다크')
    await page.keyboard.press('Enter')

    await expect(palette(page)).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await page.evaluate(() => localStorage.getItem('md.theme'))).toBe('dark')
  })
})

test.describe('F-2054 A9 보기 — 토글 라벨', () => {
  test('줄 번호 숨기기 → 표시하기', async ({ page }) => {
    await prepareDoc(page)
    await page.keyboard.press('Control+p')
    await palette(page).locator('.command-palette-input').fill('>줄 번호')
    await expect(paletteOptions(page)).toHaveCount(1)
    await expect(paletteOptions(page).first()).toHaveText(/줄 번호 숨기기/)
    await page.keyboard.press('Enter')

    expect(await page.evaluate(() => localStorage.getItem('md.lineNumbers'))).toBe('off')

    await page.keyboard.press('Control+p')
    await palette(page).locator('.command-palette-input').fill('>줄 번호')
    await expect(paletteOptions(page).first()).toHaveText(/줄 번호 표시하기/)
  })
})

test.describe('F-2054 A10 내보내기 — .md 내려받기', () => {
  test('파일명이 문서 제목', async ({ page }) => {
    await openApp(page)
    await fillTitle(page, '내보낼 문서')
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+p')
    await palette(page).locator('.command-palette-input').fill('>.md 내보내기')

    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')])
    expect(download.suggestedFilename()).toBe('내보낼 문서.md')
  })
})

test.describe('F-2054 A11 공유 — 마크다운 복사', () => {
  test('알림과 클립보드 내용', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    // 저장 공간 보호 warn 알림(F-118)이 이 info 알림을 막는다 — 이미 본 것으로 표시해 안 뜨게 한다
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    await importMarkdown(page, { content: '# 가\n본문\n' })
    await page.locator('.cm-content').click()
    await runCommand(page, '>마크다운 복사')

    await expect(page.locator('.notice--info .notice-message')).toHaveText('마크다운을 복사했습니다.')
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    // 앱은 LF 로 쓰고 Windows 클립보드 왕복이 CRLF 로 바꾼다 — 줄바꿈은 비교에서 뺀다 (H656 오탐, editor.spec.js 205행과 같은 현상)
    expect(clip.replace(/\r\n/g, '\n')).toBe('# 가\n본문\n')
  })
})

test.describe('F-2054 A12 화면별 — 홈', () => {
  test('이동·만들기·보기만 보이고 문서 대상 명령은 없다', async ({ page }) => {
    await stubPrint(page)
    await openAppHome(page)
    await page.keyboard.press('Control+p')
    await palette(page).locator('.command-palette-input').fill('>')

    const texts = await paletteOptions(page).allTextContents()
    expect(texts.some((t) => t.includes('새 문서'))).toBe(true)
    expect(texts.some((t) => t.includes('설정 열기'))).toBe(true)
    expect(texts.some((t) => t.includes('여러 문서 검색'))).toBe(true)
    expect(texts.some((t) => t.includes('홈으로'))).toBe(false)
    expect(texts.some((t) => t.includes('.md 내보내기'))).toBe(false)
    expect(texts.some((t) => t.includes('이 문서 삭제'))).toBe(false)
    expect(texts.some((t) => t.includes('편집 모드로 전환'))).toBe(false)
    expect(texts.some((t) => t.includes('PDF (A4 인쇄)'))).toBe(false)
    expect(await printCallCount(page)).toBe(0)
  })
})
