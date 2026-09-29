// 초대와 권한 — 공유받음 묶음·읽기 전용·초대 대화상자 (specs/features/F-212.md 3장 A5·A6, F-225 다시 그리기)
import { test, expect } from '@playwright/test'
import { openApp, waitSaved } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

async function typeIntoEditor(page, text) {
  await page.locator('.cm-content').click()
  await page.keyboard.type(text)
}

// GET /api/(docs|folders)/:id/grants, PUT·DELETE …/grants/:email 을 메모리로 흉내낸다 (fakeServer.js 밖 전용)
async function fakeGrants(page) {
  const grants = new Map() // key `${targetId}:${email}` -> {email, role, createdAt}

  await page.route(/\/api\/(docs|folders)\/[^/]+\/grants$/, async (route) => {
    const req = route.request()
    const targetId = decodeURIComponent(new URL(req.url()).pathname.split('/').slice(-2, -1)[0])
    if (req.method() !== 'GET') return route.fallback()
    const list = [...grants.values()].filter((g) => g.targetId === targetId).map(({ email, role, createdAt }) => ({ email, role, createdAt }))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) })
  })

  await page.route(/\/api\/(docs|folders)\/[^/]+\/grants\/[^/]+$/, async (route) => {
    const req = route.request()
    const parts = new URL(req.url()).pathname.split('/')
    const email = decodeURIComponent(parts.pop())
    parts.pop() // 'grants'
    const targetId = decodeURIComponent(parts.pop())
    const key = `${targetId}:${email}`
    if (req.method() === 'PUT') {
      const body = req.postDataJSON()
      const record = { targetId, email, role: body.role, createdAt: grants.get(key)?.createdAt ?? Date.now() }
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
    // 제목은 F-217 로 본문 맨 위 textarea 다 — disabled 가 아니라 readOnly 로 막는다
    await expect(page.locator('.doc-title')).not.toBeEditable()

    // edit 문서 — 평소처럼 편집, 저장된다
    await page.getByText('편집 가능 문서').click()
    await expect(page.locator('.cm-content')).toContainText('편집 전')
    await typeIntoEditor(page, ' + 편집됨')
    await waitSaved(page)
    await expect.poll(() => shared.get('edit-doc')?.content).toBe('편집 전 + 편집됨')
  })
})

test.describe('F-212 A6 사람 초대 대화상자', () => {
  test('F-212 A6·F-225 A3·A4·A6 초대 추가·형식 오류·역할 변경·삭제 뒤 포커스', async ({ page }) => {
    await fakeServer(page)
    await fakeGrants(page)
    await openApp(page)

    // 공유 메뉴에서 사람 초대 열기 (첫 실행 안내 문서가 owner 문서)
    const dialog = await openInviteDialogFromShare(page)
    await expect(dialog).toBeVisible()

    let putCount = 0
    let deleteCount = 0
    page.on('request', (req) => {
      if (req.method() === 'PUT' && /\/grants\//.test(req.url())) putCount += 1
      if (req.method() === 'DELETE' && /\/grants\//.test(req.url())) deleteCount += 1
    })

    // 형식 오류 — aria-invalid, 문구, 요청 없음
    await dialog.locator('.invite-email-input').fill('not-an-email')
    await dialog.getByRole('button', { name: '초대' }).click()
    await expect(dialog.getByText('이메일 주소를 확인하세요.')).toBeVisible()
    await expect(dialog.locator('.invite-input-group')).toHaveAttribute('aria-invalid', 'true')
    expect(putCount).toBe(0)

    // 초대 추가(기본 보기) — 입력은 비워지고 포커스 유지
    await dialog.locator('.invite-email-input').fill('friend@example.com')
    await dialog.getByRole('button', { name: '초대' }).click()
    await expect(dialog.locator('.invite-grant-row')).toHaveCount(1)
    await expect(dialog.locator('.invite-grant-row')).toContainText('friend@example.com')
    await expect(page.locator('.notice')).toContainText('friend@example.com 님에게 보기 권한을 줬습니다.')
    await expect(dialog.locator('.invite-email-input')).toHaveValue('')
    await expect(dialog.locator('.invite-email-input')).toBeFocused()
    expect(putCount).toBe(1)

    // 역할 변경 — 편집으로
    const row = dialog.locator('.invite-grant-row').filter({ hasText: 'friend@example.com' })
    await row.getByRole('radio', { name: '편집' }).click()
    await expect(row.getByRole('radio', { name: '편집' })).toHaveAttribute('aria-checked', 'true')

    // 가운데 삭제 뒤 포커스가 다음 행 삭제로
    await inviteOne(dialog, 'b@example.com', 'view')
    await inviteOne(dialog, 'c@example.com', 'view')
    await dialog.locator('.invite-grant-row').filter({ hasText: 'b@example.com' }).getByRole('button', { name: '삭제' }).click()
    await expect(dialog.locator('.invite-grant-row')).toHaveCount(2)
    expect(deleteCount).toBe(1)
    const nextRow = dialog.locator('.invite-grant-row').filter({ hasText: 'c@example.com' })
    await expect(nextRow.getByRole('button', { name: '삭제' })).toBeFocused()

    // 남은 행 삭제
    await row.getByRole('button', { name: '삭제' }).click()
    await expect(dialog.locator('.invite-grant-row')).toHaveCount(1)
  })
})

async function openInviteDialogFromShare(page) {
  await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
  await page.getByRole('menuitem', { name: '사람 초대…' }).click()
  return page.locator('.dialog[open]')
}

async function inviteOne(dialog, email, role) {
  await dialog.locator('.invite-email-input').fill(email)
  if (role === 'edit') {
    await dialog.getByRole('radiogroup', { name: '권한' }).getByRole('radio', { name: '편집' }).click()
  }
  await dialog.getByRole('button', { name: '초대' }).click()
  await expect(dialog.locator('.invite-grant-row').filter({ hasText: email })).toBeVisible()
}

// F-225 A7 좁은 창 가로 넘침은 e2e/dialogLayout.spec.js 의 합친 테스트로 옮겼다 (2026-09-25 e2e 경량화)
