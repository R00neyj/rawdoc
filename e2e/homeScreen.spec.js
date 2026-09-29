// 시작 화면 홈, 설정에서 마지막 문서 토글 (specs/features/F-232.md)
import { test, expect } from '@playwright/test'
import brand from '../brand.config.ts'
import { openApp, openAppHome, importMarkdown, currentDocId, waitSaved, setPrefBeforeLoad } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

async function goHome(page) {
  await page.getByRole('button', { name: `${brand.name} 홈으로` }).click()
}

test.describe('F-232 A2·A6·A7·A8·리뷰 A4 홈 흐름', () => {
  test('F-232 A2·A6·A7·A8·리뷰 A4 해시 없이 열면 홈, 목록 클릭·로고로 오가고, 문서 해시 우선, 모르는 해시는 알림', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1') // 저장 공간 알림이 먼저 뜨면 info 알림이 가려진다(notice.ts)
    await openAppHome(page) // 빈 저장소 — 문서 0개 (F-257 7장)
    await importMarkdown(page, { name: 'a.md', content: '문서 A\n' })
    await importMarkdown(page, { name: 'b.md', content: '문서 B\n' })

    // A2 문서를 연 채로 해시를 지우고 새로 고쳐 "해시 없이 새로 열기"를 재현한다
    await page.evaluate(() => history.replaceState(null, '', '/'))
    await page.reload()
    await expect(page.locator('.empty-state p')).toHaveText('문서를 선택하거나 새로 만드세요.')
    expect(await currentDocId(page)).toBeNull()
    await expect(page.locator('.tree-row')).toHaveCount(2)

    // A6 사이드바 클릭
    await page.locator('.doc-item-btn').first().click()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    const docId = await currentDocId(page)
    expect(docId).not.toBeNull()

    // A7 로고 → 홈, 이미 홈이면 다시 눌러도 조용히 아무 일 없다 (3.3)
    await goHome(page)
    await expect(page.locator('.empty-state')).toBeVisible()
    expect(await currentDocId(page)).toBeNull()
    await expect(page.locator('.tree-row')).toHaveCount(2)
    await goHome(page)
    await expect(page.locator('.empty-state')).toBeVisible()

    // A8 #/d/{id} 주소는 설정과 무관하게 그 문서가 열린다
    await page.goto(`/#/d/${docId}`)
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    expect(await currentDocId(page)).toBe(docId)

    // 리뷰 A4 인식 못 한 해시는 홈이 아니라 첫 문서 + 알림
    await page.evaluate(() => { location.hash = '#abc' })
    await expect(page.locator('.notice-message')).toHaveText('문서를 찾을 수 없습니다.')
    expect(await currentDocId(page)).toBe(docId)
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

test.describe('F-241 A4·A5·A7 홈의 최근 문서', () => {
  test('F-241 A4·A5·A7 최근 목록이 최신순, 항목 클릭으로 열림, 고쳐 저장하면 맨 위로', async ({ page }) => {
    await openAppHome(page)
    const idA = await importMarkdown(page, { name: 'A.md', content: '문서 A\n' })
    await importMarkdown(page, { name: 'B.md', content: '문서 B\n' })
    await importMarkdown(page, { name: 'C.md', content: '문서 C\n' })
    await goHome(page)

    let items = page.locator('.empty-state-recent-item')
    await expect(items).toHaveCount(3)
    await expect(items.first()).toContainText('C')
    await expect(items.last()).toContainText('A')

    await items.filter({ hasText: 'A' }).click()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    expect(await currentDocId(page)).toBe(idA)

    await page.locator('.cm-content').click()
    await page.keyboard.type('고침')
    await waitSaved(page)
    await goHome(page)

    items = page.locator('.empty-state-recent-item')
    await expect(items.first()).toContainText('A')
  })
})

test.describe('F-241 A8 공유 문서 제외', () => {
  test('최근 목록에는 내 문서만 보이고 공유받은 문서는 섞이지 않는다', async ({ page }) => {
    await fakeServer(page)
    await page.route('**/api/shared', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'shared-doc',
            title: '공유받은 문서',
            lineEnding: 'lf',
            folderId: null,
            pinnedAt: null,
            version: 1,
            createdAt: Date.now(),
            updatedAt: Date.now() + 10_000, // 내 문서보다 더 최근이어도 섞이면 안 된다
            role: 'view',
            ownerEmail: 'owner@x.com',
          },
        ]),
      }),
    )
    await openAppHome(page)
    await importMarkdown(page, { name: 'my-doc.md', content: '내 문서\n' })
    await goHome(page)

    const items = page.locator('.empty-state-recent-item')
    await expect(items).toHaveCount(1)
    await expect(items).toContainText('my-doc')
  })
})
