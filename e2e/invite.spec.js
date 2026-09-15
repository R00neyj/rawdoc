// 초대와 권한 — 공유받음 묶음·읽기 전용·초대 대화상자 (specs/features/F-212.md 3장 A5·A6)
import { test, expect } from '@playwright/test'
import { openApp, waitSaved } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

async function typeIntoEditor(page, text) {
  await page.locator('.cm-content').click()
  await page.keyboard.type(text)
}

// GET /api/docs/:id/grants, PUT·DELETE /api/docs/:id/grants/:email 을 메모리로 흉내낸다 (fakeServer.js 밖 전용)
async function fakeGrants(page) {
  const grants = new Map() // key `${docId}:${email}` -> {email, role, createdAt}

  await page.route(/\/api\/docs\/[^/]+\/grants$/, async (route) => {
    const req = route.request()
    const docId = decodeURIComponent(new URL(req.url()).pathname.split('/').slice(-2, -1)[0])
    if (req.method() !== 'GET') return route.fallback()
    const list = [...grants.values()].filter((g) => g.docId === docId).map(({ email, role, createdAt }) => ({ email, role, createdAt }))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) })
  })

  await page.route(/\/api\/docs\/[^/]+\/grants\/[^/]+$/, async (route) => {
    const req = route.request()
    const parts = new URL(req.url()).pathname.split('/')
    const email = decodeURIComponent(parts.pop())
    parts.pop() // 'grants'
    const docId = decodeURIComponent(parts.pop())
    const key = `${docId}:${email}`
    if (req.method() === 'PUT') {
      const body = req.postDataJSON()
      const record = { docId, email, role: body.role, createdAt: grants.get(key)?.createdAt ?? Date.now() }
      grants.set(key, record)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email, role: body.role }) })
    }
    if (req.method() === 'DELETE') {
      grants.delete(key)
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })

  return grants
}

test.describe('F-212 A5 공유받음 묶음·읽기 전용', () => {
  test('view 문서는 읽기 전용, edit 문서는 편집 가능', async ({ page }) => {
    await fakeServer(page) // 로그인·내 문서(빈 목록) 흉내 — 공유받은 문서는 server.docs 와 별도로 흉내낸다(그 맵은 GET /api/docs 목록에도 쓰여 섞으면 내 문서로 겹쳐 보인다)
    const now = Date.now()
    const shared = new Map([
      ['view-doc', { id: 'view-doc', title: '보기 전용 문서', content: '원본 내용', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now }],
      ['edit-doc', { id: 'edit-doc', title: '편집 가능 문서', content: '편집 전', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now }],
    ])

    await page.route(/\/api\/docs\/(view-doc|edit-doc)$/, async (route) => {
      const req = route.request()
      const id = new URL(req.url()).pathname.split('/').pop()
      const doc = shared.get(id)
      if (req.method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) })
      }
      if (req.method() === 'PUT') {
        const body = req.postDataJSON()
        if (body.title !== undefined) doc.title = body.title
        if (body.content !== undefined) doc.content = body.content
        doc.version += 1
        doc.updatedAt = Date.now()
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) })
      }
      return route.fallback()
    })

    await page.route('**/api/shared', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'view-doc', title: '보기 전용 문서', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now, role: 'view', ownerEmail: 'owner@x.com' },
          { id: 'edit-doc', title: '편집 가능 문서', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now, role: 'edit', ownerEmail: 'owner@x.com' },
        ]),
      }),
    )

    await openApp(page)

    const sharedGroup = page.locator('.sidebar').getByText('공유받음')
    await expect(sharedGroup).toBeVisible()
    await expect(page.getByText('보기 전용 문서')).toBeVisible()
    await expect(page.getByText('편집 가능 문서')).toBeVisible()
    await expect(page.getByText('owner')).toHaveCount(2) // 소유자 이메일 앞부분

    // view 문서 — 읽기 전용, 알림 띠, 입력이 반영되지 않는다
    await page.getByText('보기 전용 문서').click()
    await expect(page.locator('.cm-content')).toContainText('원본 내용')
    await expect(page.locator('.notice')).toContainText('보기 권한만 있는 문서입니다.')
    await page.locator('.cm-content').click()
    await page.keyboard.type('추가 입력')
    await expect(page.locator('.cm-content')).not.toContainText('추가 입력')
    await expect(page.locator('.doc-title')).toBeDisabled()

    // edit 문서 — 평소처럼 편집, 저장된다
    await page.getByText('편집 가능 문서').click()
    await expect(page.locator('.cm-content')).toContainText('편집 전')
    await typeIntoEditor(page, ' + 편집됨')
    await waitSaved(page)
    await expect.poll(() => shared.get('edit-doc')?.content).toBe('편집 전 + 편집됨')
  })
})

test.describe('F-212 A6 사람 초대 대화상자', () => {
  test('초대 추가·역할 변경·삭제·형식 오류', async ({ page }) => {
    await fakeServer(page)
    await fakeGrants(page)
    await openApp(page)

    // 공유 메뉴에서 사람 초대 열기 (첫 실행 안내 문서가 owner 문서)
    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await page.getByRole('menuitem', { name: '사람 초대…' }).click()

    const dialog = page.locator('.dialog[open]')
    await expect(dialog).toBeVisible()

    // 형식 오류
    await dialog.locator('.invite-email-input').fill('not-an-email')
    await dialog.getByRole('button', { name: '초대' }).click()
    await expect(dialog.getByText('이메일 주소를 확인하세요.')).toBeVisible()

    // 초대 추가(기본 보기)
    await dialog.locator('.invite-email-input').fill('friend@example.com')
    await dialog.getByRole('button', { name: '초대' }).click()
    await expect(dialog.locator('.invite-grant-row')).toHaveCount(1)
    await expect(dialog.locator('.invite-grant-row')).toContainText('friend@example.com')
    await expect(page.locator('.notice')).toContainText('friend@example.com 님에게 보기 권한을 줬습니다.')

    // 역할 변경 — 편집으로
    const row = dialog.locator('.invite-grant-row').first()
    await row.getByRole('radio', { name: '편집' }).click()
    await expect(row.getByRole('radio', { name: '편집' })).toHaveAttribute('aria-checked', 'true')

    // 삭제
    await row.getByRole('button', { name: '삭제' }).click()
    await expect(dialog.locator('.invite-grant-row')).toHaveCount(0)
  })
})
