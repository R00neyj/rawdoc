// 시작 화면 홈, 설정에서 마지막 문서 토글 (specs/features/F-232.md)
import { test, expect } from '@playwright/test'
import brand from '../brand.config.ts'
import { openApp, openAppHome, setPrefBeforeLoad, importMarkdown, currentDocId } from './helpers.js'

async function mockPublicDoc(page) {
  await page.route('**/pub/docs/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ title: '공개 문서', content: '본문\n', lineEnding: 'lf', updatedAt: 1_700_000_000_000 }),
    }),
  )
}

test.describe('F-232 A2 첫 진입 — 홈 기본값', () => {
  test('문서가 여러 개 있어도 해시 없이 열면 홈 화면, 특정 문서는 자동으로 안 열린다', async ({ page }) => {
    await openAppHome(page) // 최초 실행 안내 문서 1개가 자동으로 생긴다
    await importMarkdown(page, { name: 'a.md', content: '문서 A\n' })
    await importMarkdown(page, { name: 'b.md', content: '문서 B\n' })

    // 문서를 연 채로 해시를 지우고 새로 고쳐 "해시 없이 새로 열기"를 재현한다
    await page.evaluate(() => history.replaceState(null, '', '/'))
    await page.reload()

    await expect(page.locator('.empty-state p')).toHaveText('문서를 선택하거나 새로 만드세요.')
    expect(await currentDocId(page)).toBeNull()
    await expect(page.locator('.tree-row')).toHaveCount(3)
  })
})

test.describe('F-232 A3 문서 0개 홈', () => {
  test('문서가 하나도 없으면 문구가 다르다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.firstRunDone', '1') // 안내 문서 생성을 막아 진짜 0개로 만든다
    await openAppHome(page)
    await expect(page.locator('.empty-state p')).toHaveText('문서가 없습니다.')
  })
})

test.describe('F-232 A4 문서 있는 홈', () => {
  test('문서가 1개 이상이면 문구가 다르다', async ({ page }) => {
    await openAppHome(page) // 안내 문서 1개
    await expect(page.locator('.empty-state p')).toHaveText('문서를 선택하거나 새로 만드세요.')
    await expect(page.locator('.tree-row')).toHaveCount(1)
  })
})

test.describe('F-232 A5 마지막 문서 토글', () => {
  test('설정에서 마지막 문서를 고르면 새로고침 후 부팅 시 자동으로 열린다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '문서\n' })

    await page.getByRole('button', { name: '설정' }).click()
    await page.getByRole('radio', { name: '마지막 문서' }).click()
    await page.getByRole('button', { name: '닫기', exact: true }).click()

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    expect(await currentDocId(page)).toBe(docId)
  })
})

test.describe('F-232 A6 사이드바 클릭', () => {
  test('홈에서 목록 문서를 클릭하면 그 문서가 열리고 해시가 붙는다', async ({ page }) => {
    await openAppHome(page) // 안내 문서 1개
    await page.locator('.doc-item-btn').first().click()

    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    expect(await currentDocId(page)).not.toBeNull()
  })
})

test.describe('F-232 A7 로고 → 홈', () => {
  test('문서를 연 상태에서 로고를 누르면 홈으로 돌아간다', async ({ page }) => {
    await openAppHome(page) // 안내 문서 1개
    await page.locator('.doc-item-btn').first().click()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()

    await page.getByRole('button', { name: `${brand.name} 홈으로` }).click()

    await expect(page.locator('.empty-state')).toBeVisible()
    expect(await currentDocId(page)).toBeNull()
    await expect(page.locator('.tree-row')).toHaveCount(1) // 사이드바 유지

    // 이미 홈이면 다시 눌러도 조용히 아무 일 없다 (3.3)
    await page.getByRole('button', { name: `${brand.name} 홈으로` }).click()
    await expect(page.locator('.empty-state')).toBeVisible()
  })
})

test.describe('F-232 A8 특정 문서 해시 우선', () => {
  test('startScreen=home 이어도 #/d/{id} 주소로 열면 설정과 무관하게 그 문서가 열린다', async ({ page }) => {
    await openAppHome(page)
    await page.locator('.doc-item-btn').first().click()
    const docId = await currentDocId(page)
    expect(docId).not.toBeNull()

    await page.goto(`/#/d/${docId}`)
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    expect(await currentDocId(page)).toBe(docId)
  })
})

test.describe('F-232 A9 공유·공개 화면 무관', () => {
  test('#/p/{토큰} 로 열면 설정과 무관하게 공개 보기 화면이 뜬다', async ({ page }) => {
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')

    await expect(page.locator('.public-view-title')).toBeVisible()
    await expect(page.locator('.empty-state')).toHaveCount(0)
    await expect(page.locator('.sidebar')).toHaveCount(0)
  })
})

test.describe('F-232 A10 공개 화면 설정 대화상자', () => {
  test('PublicView 설정 대화상자에는 시작 화면 항목이 없다', async ({ page }) => {
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')

    await page.locator('.public-view-settings').click()
    await expect(page.locator('#settings-title')).toBeVisible()
    await expect(page.locator('#start-screen-label')).toHaveCount(0)
  })
})
