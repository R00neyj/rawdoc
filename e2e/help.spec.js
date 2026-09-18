// 도움말 전용 페이지 (specs/features/F-244.md)
import { test, expect } from '@playwright/test'
import { openApp } from './helpers.js'

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

    await expect(helpPage.locator('.help-page-body table')).toBeVisible()
    await expect(helpPage.locator('.help-page-body .markdown-callout')).toBeVisible()
  })
})

test.describe('F-244 A6 원문·결과 둘 다', () => {
  test('굵게 항목 — 코드블록에 원문, 그 아래 실제 렌더 결과', async ({ page }) => {
    await openApp(page)
    const helpPage = await openHelpPage(page)

    const boldSource = helpPage.locator('pre', { hasText: '**굵게**' }).first()
    await expect(boldSource.locator('code')).toHaveText('**굵게**')
    await expect(helpPage.locator('.help-page-body strong', { hasText: '굵게' })).toBeVisible()
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
    await expect(page.locator('.sidebar').getByRole('button', { name: '마크다운 문법', exact: true })).toBeVisible()
  })
})

test.describe('F-244 A10 직접 진입', () => {
  test('#/help 주소로 새로 열면 도움말 페이지가 뜬다', async ({ page }) => {
    await page.goto('/#/help')
    await expect(page.locator('.help-page')).toBeVisible()
    await expect(page.locator('.help-page-title')).toHaveText('도움말')
  })
})
