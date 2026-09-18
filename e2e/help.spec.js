// 도움말 전용 페이지 (specs/features/F-244.md), 오른쪽 목차 (F-249.md)
import { test, expect } from '@playwright/test'
import { openApp, resizeWindow } from './helpers.js'

// 그룹 순서 — F-244.md 3.1 이 명시한 순서 그대로(helpSyntax.ts 와 같다)
const EXPECTED_GROUP_ORDER = [
  '제목',
  '강조',
  '목록',
  '인용',
  '링크',
  '위키링크',
  '표',
  '코드블록',
  '이미지',
  '콜아웃',
  '구분선',
  '프론트매터',
]

async function openHelpPage(page) {
  await page.getByRole('button', { name: '도움말' }).first().click()
  await expect(page.locator('.help-page')).toBeVisible()
  return page.locator('.help-page')
}

test.describe('F-244 A4 열기', () => {
  test('사이드바 도움말 클릭 — 전체 화면, 해시 #/help, 대화상자 없음', async ({ page }) => {
    await openApp(page)
    await openHelpPage(page)
    await expect(page).toHaveURL(/#\/help$/)
    await expect(page.locator('.dialog[open]')).toHaveCount(0)
  })
})

test.describe('F-244 A5 내용', () => {
  test('묶음 제목이 명세 순서로 다 있고 표·콜아웃이 실제로 렌더된다', async ({ page }) => {
    await openApp(page)
    const helpPage = await openHelpPage(page)

    // 제목 문법 자체를 실제로 쓴 결과(# 제목 1 등)도 h2 로 섞여 들어간다(3.1) — 순서(부분열)만 확인한다
    const titles = await helpPage.locator('.help-page-body h2').allTextContents()
    let cursor = 0
    for (const name of EXPECTED_GROUP_ORDER) {
      const idx = titles.indexOf(name, cursor)
      expect(idx, `${name} 이 ${cursor} 이후에 있어야 한다: ${JSON.stringify(titles)}`).toBeGreaterThanOrEqual(cursor)
      cursor = idx + 1
    }

    // F-257.md 2장의 "자주 쓰는 문법" 요약 표가 하나 더 생겨 표가 여럿이다 — 하나 이상만 확인한다
    await expect(helpPage.locator('.help-page-body table').first()).toBeVisible()
    await expect(helpPage.locator('.help-page-body .markdown-callout')).toBeVisible()
  })
})

test.describe('F-244 A6 원문·결과 둘 다', () => {
  test('굵게 항목 — 코드블록에 원문, 그 아래 실제 렌더 결과', async ({ page }) => {
    await openApp(page)
    const helpPage = await openHelpPage(page)

    const boldSource = helpPage.locator('pre', { hasText: '**굵게**' }).first()
    await expect(boldSource.locator('code')).toHaveText('**굵게**')
    // F-257.md 2장 요약 표에도 굵게 예시가 있어 <strong> 이 여럿이다 — 하나 이상만 확인한다
    await expect(helpPage.locator('.help-page-body strong', { hasText: '굵게' }).first()).toBeVisible()
  })
})

test.describe('F-244 A7 코드 복사', () => {
  test('코드블록 복사 버튼 — 그 문법 원문이 클립보드에', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    const helpPage = await openHelpPage(page)

    const boldSource = helpPage.locator('pre', { hasText: '**굵게**' }).first()
    await boldSource.locator('.code-copy-btn').click()
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    // markdown-it 펜스 렌더는 내용 끝에 줄바꿈 하나를 붙인다(F-240 A6 과 같은 이유) — 트림해 비교한다
    expect(clip.replace(/\r\n/g, '\n').trim()).toBe('**굵게**')
  })
})

test.describe('F-244 A8 닫기', () => {
  test('닫기 — 홈으로', async ({ page }) => {
    await openApp(page)
    const helpPage = await openHelpPage(page)
    await helpPage.getByRole('button', { name: '닫기' }).click()
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.locator('.help-page')).toHaveCount(0)
  })
})

test.describe('F-244 A9 내 문서로 복사', () => {
  test('버튼 클릭 — 새 문서가 열리고 사이드바 목록에 생긴다', async ({ page }) => {
    await openApp(page)
    const helpPage = await openHelpPage(page)
    await helpPage.getByRole('button', { name: '내 문서로 복사' }).click()

    await expect(page).toHaveURL(/#\/d\/.+/)
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    // 문서 목록 행(.tree-row) 으로 좁혀 확인한다 — 사이드바 도움말 이동 버튼과 이름이 같다(F-257.md G2)
    await expect(page.locator('.sidebar .tree-row', { hasText: '도움말' })).toBeVisible()
  })
})

test.describe('F-244 A10 직접 진입', () => {
  test('#/help 주소로 새로 열면 도움말 페이지가 뜬다', async ({ page }) => {
    await page.goto('/#/help')
    await expect(page.locator('.help-page')).toBeVisible()
    await expect(page.locator('.help-page-title')).toHaveText('도움말')
  })
})

test.describe('F-249 A3 목차 보임', () => {
  test('넓은 창 — 오른쪽에 목차가 보이고 항목 수가 제목 수와 같다', async ({ page }) => {
    await resizeWindow(page, 1400, 900)
    await page.goto('/#/help')
    await expect(page.locator('.help-page')).toBeVisible()
    await expect(page.locator('nav.outline')).toBeVisible()

    const headingCount = await page.locator('.help-page-body h1, .help-page-body h2, .help-page-body h3').count()
    await expect(page.locator('.outline-rail-item')).toHaveCount(headingCount)
  })
})

test.describe('F-249 A4 이동', () => {
  test('목차의 표 항목 클릭 — 본문이 그 제목으로 스크롤된다', async ({ page }) => {
    await resizeWindow(page, 1400, 900)
    await page.goto('/#/help')
    await expect(page.locator('nav.outline')).toBeVisible()

    await page.locator('nav.outline').hover()
    await page.locator('.outline-item', { hasText: /^표$/ }).click()

    await expect(page.locator('.help-page-body h2', { hasText: /^표$/ })).toBeInViewport()
  })
})

test.describe('F-249 A5 좁은 창', () => {
  test('선 목차 대신 목차 버튼이 보이고 누르면 카드가 열린다', async ({ page }) => {
    await resizeWindow(page, 900, 700)
    await page.goto('/#/help')
    await expect(page.locator('.help-page')).toBeVisible()

    await expect(page.locator('nav.outline')).toHaveCount(0)
    const btn = page.locator('.outline-btn')
    await expect(btn).toBeVisible()
    await btn.click()
    await expect(page.locator('.outline-popup-card')).toBeVisible()
  })
})

// 앱 사용법 절이 추가된 뒤에도 렌더가 깨지지 않는지 (F-257.md 5장 G5)
test.describe('F-257 G5 앱 사용법 절 렌더', () => {
  test('새 절 제목이 보이고 표·체크박스·콜아웃이 깨지지 않는다', async ({ page }) => {
    await openApp(page)
    const helpPage = await openHelpPage(page)

    await expect(helpPage.locator('h2', { hasText: '이 앱은' })).toBeVisible()
    await expect(helpPage.locator('h2', { hasText: '단축키' })).toBeVisible()
    await expect(helpPage.locator('table').first()).toBeVisible()
    await expect(helpPage.locator('.markdown-callout')).toBeVisible()
    await expect(helpPage.locator('input[type="checkbox"]').first()).toBeVisible()
  })
})

// 오른쪽 목차에 새 절이 모두 뜨는지 (F-257.md 5장 G6, F-249 A3 회귀)
test.describe('F-257 G6 목차에 새 절 반영', () => {
  test('넓은 창 — 목차 항목 수가 본문 제목 수와 같고 앱 사용법 절도 들어 있다', async ({ page }) => {
    await resizeWindow(page, 1400, 900)
    await page.goto('/#/help')
    await expect(page.locator('.help-page')).toBeVisible()
    await expect(page.locator('nav.outline')).toBeVisible()

    const headingCount = await page.locator('.help-page-body h1, .help-page-body h2, .help-page-body h3').count()
    await expect(page.locator('.outline-rail-item')).toHaveCount(headingCount)

    await page.locator('nav.outline').hover()
    await expect(page.locator('.outline-item', { hasText: '문서 관리' })).toBeVisible()
  })
})
