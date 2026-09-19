// 공개 보기 화면 S-5 (specs/features/F-210.md 2.4·2.5)
import { test, expect } from '@playwright/test'
import brand from '../brand.config.ts'

const DOC = {
  title: '공개 문서',
  content: '# 제목1\n\n본문\n\n## 제목2\n\n```js\nconsole.log(1)\n```\n\n### 제목3\n',
  lineEnding: 'lf',
  updatedAt: 1_700_000_000_000,
}

async function mockPublicDoc(page, body = DOC, status = 200) {
  await page.route('**/pub/docs/**', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  )
}

async function indexedDbDocCount(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => resolve(0)
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('docs')) {
            resolve(0)
            return
          }
          const tx = db.transaction('docs', 'readonly')
          const countReq = tx.objectStore('docs').count()
          countReq.onsuccess = () => resolve(countReq.result)
          countReq.onerror = () => resolve(0)
        }
      }),
  )
}

test.describe('F-210 A5 공개 보기 화면', () => {
  test('제목·본문·목차가 보이고 사이드바·상단바 없음, 저장소를 열지 않는다', async ({ page }) => {
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')

    await expect(page.locator('.public-view-title')).toHaveText(DOC.title)
    await expect(page.locator('.viewer h1')).toHaveText('제목1')
    await expect(page.locator('.outline-rail-item')).toHaveCount(3)
    await expect(page.locator('.sidebar')).toHaveCount(0)
    await expect(page.locator('.topbar')).toHaveCount(0)
    await expect(page.locator('.statusbar')).toHaveCount(0)
    await expect(page).toHaveTitle(DOC.title)

    expect(await indexedDbDocCount(page)).toBe(0)
  })
})

test.describe('F-210 A6 코드블록 복사 버튼', () => {
  test('누르면 클립보드에 원문이 담기고 아이콘이 바뀐다', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')

    const btn = page.locator('.code-copy-btn')
    await expect(btn).toBeVisible()
    await btn.click()

    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip.trim()).toBe('console.log(1)')
    await expect(btn.locator('svg')).toBeVisible()
  })
})

test.describe('F-210 A7 오류', () => {
  test('404 — 링크가 없거나 끊겼습니다', async ({ page }) => {
    await mockPublicDoc(page, { error: 'not_found' }, 404)
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-body')).toContainText('링크가 없거나 끊겼습니다.')
  })

  test('네트워크 오류 — 문구 + 다시 시도로 재요청', async ({ page }) => {
    // 시작 문서 요청만 센다 — 묶음 목록(/set) 요청은 F-252.md 4.4 에 따라 같이 나가지만 실패해도 시작 문서 표시는 막지 않는다
    await page.route('**/pub/docs/tok123/set', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ docs: [] }) }),
    )
    let calls = 0
    await page.route('**/pub/docs/tok123', (route) => {
      calls++
      if (calls === 1) return route.abort('failed')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DOC) })
    })
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-body')).toContainText('링크를 불러오지 못했습니다. 연결을 확인하세요.')

    await page.getByRole('button', { name: '다시 시도' }).click()
    await expect(page.locator('.public-view-title')).toHaveText(DOC.title)
    expect(calls).toBe(2)
  })
})

test.describe('F-210 A8 내보내기', () => {
  test('.md 내보내기 — 응답 content 바이트 그대로', async ({ page }) => {
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-title')).toHaveText(DOC.title)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '.md 내보내기' }).click(),
    ])
    expect(download.suggestedFilename()).toBe(`${DOC.title}.md`)
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString('utf-8')).toBe(DOC.content)
  })
})

// 폴더 공개 보기 (specs/features/F-211.md 2.3)
const FOLDER = {
  name: '공유 폴더',
  folders: [{ id: 'sub1', name: '하위 폴더', parentId: 'root' }],
  docs: [
    { id: 'd1', title: '문서1', folderId: 'root', updatedAt: 100 },
    { id: 'd2', title: '문서2', folderId: 'root', updatedAt: 200 },
    { id: 'd3', title: '문서3', folderId: 'sub1', updatedAt: 300 },
  ],
}

const FOLDER_DOCS = {
  d1: { title: '문서1', content: '# 문서1 제목\n\n본문1\n', lineEnding: 'lf', updatedAt: 100 },
  d2: { title: '문서2', content: '# 문서2 제목\n\n본문2\n', lineEnding: 'lf', updatedAt: 200 },
  d3: { title: '문서3', content: '# 문서3 제목\n\n본문3\n', lineEnding: 'lf', updatedAt: 300 },
}

async function mockPublicFolder(page, folder = FOLDER, docs = FOLDER_DOCS) {
  await page.route('**/pub/folders/*', (route) => {
    const url = route.request().url()
    if (/\/pub\/folders\/[^/]+$/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(folder) })
    }
    return route.continue()
  })
  await page.route('**/pub/folders/*/docs/*', (route) => {
    const url = new URL(route.request().url())
    const docId = url.pathname.split('/').pop()
    const doc = docs[docId]
    if (!doc) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) })
  })
}

test.describe('F-211 A3 폴더 공개 보기', () => {
  test('목록·첫 문서·해시 교체, 다른 문서 클릭 후 뒤로 가기', async ({ page }) => {
    await mockPublicFolder(page)
    await page.goto('/#/p/f/tokF')

    await expect(page.locator('.public-folder-list-title')).toHaveText(FOLDER.name)
    await expect(page.locator('.public-folder-list-doc')).toHaveCount(3)
    // 첫 문서(root 안 updatedAt 내림차순 맨 위) = 문서2
    await expect(page.locator('.public-view-title')).toHaveText('문서2')
    await expect(page).toHaveURL(/#\/p\/f\/tokF\/d2$/)

    await page.getByRole('button', { name: '문서3' }).click()
    await expect(page.locator('.public-view-title')).toHaveText('문서3')
    await expect(page).toHaveURL(/#\/p\/f\/tokF\/d3$/)

    await page.goBack()
    await expect(page.locator('.public-view-title')).toHaveText('문서2')
  })

  test('문서가 0개면 안내 문구', async ({ page }) => {
    await mockPublicFolder(page, { name: '빈 폴더', folders: [], docs: [] }, {})
    await page.goto('/#/p/f/tokEmpty')
    await expect(page.locator('.public-view-notice')).toContainText('이 폴더에 문서가 없습니다.')
  })

  test('링크 없음 — 404', async ({ page }) => {
    await page.route('**/pub/folders/*', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) }),
    )
    await page.goto('/#/p/f/badtok')
    await expect(page.locator('.public-view-notice')).toContainText('링크가 없거나 끊겼습니다.')
  })

  test('문서 하나만 404 — 안내 문구', async ({ page }) => {
    await mockPublicFolder(page, FOLDER, { d2: FOLDER_DOCS.d2, d3: FOLDER_DOCS.d3 })
    await page.goto('/#/p/f/tokF/d1')
    await expect(page.locator('.public-view-notice')).toContainText('이 문서는 더 이상 공유되지 않습니다.')
  })
})

test.describe('F-211 A4 좁은 창', () => {
  test('900px — 목록 버튼으로 열고 닫기', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 })
    await mockPublicFolder(page)
    await page.goto('/#/p/f/tokF')
    await expect(page.locator('.public-view-title')).toHaveText('문서2')

    await expect(page.locator('.public-folder-list')).toHaveCount(0)
    await page.getByRole('button', { name: '목록' }).click()
    await expect(page.locator('.public-folder-list')).toBeVisible()
    await page.getByRole('button', { name: '문서3' }).click()
    await expect(page.locator('.public-folder-list')).toHaveCount(0)
    await expect(page.locator('.public-view-title')).toHaveText('문서3')
  })
})

test.describe('F-215 A1 문서 링크 로고', () => {
  test('머리 줄에 로고 링크와 제목이 보인다', async ({ page }) => {
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')

    const logo = page.getByRole('link', { name: `${brand.name} 열기` })
    await expect(logo).toBeVisible()
    await expect(logo).toHaveAttribute('href', '/')
    await expect(logo.locator('img.brand-icon')).toBeVisible()
    await expect(page.locator('.public-view-title')).toHaveText(DOC.title)
  })
})

test.describe('F-215 A2 폴더 링크 로고', () => {
  test('넓은 창 — 목록 안 로고 1개, 문서 머리 줄에는 없음', async ({ page }) => {
    await mockPublicFolder(page)
    await page.goto('/#/p/f/tokF')
    await expect(page.locator('.public-view-title')).toHaveText('문서2')

    await expect(page.getByRole('link', { name: `${brand.name} 열기` })).toHaveCount(1)
    await expect(page.locator('.public-folder-list').getByRole('link', { name: `${brand.name} 열기` })).toBeVisible()
    await expect(page.locator('.public-view-main .public-brand')).toHaveCount(0)
  })
})

test.describe('F-215 A3 좁은 창', () => {
  test('800px 폴더 링크 — 머리 줄에 로고 + 목록 버튼', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 800 })
    await mockPublicFolder(page)
    await page.goto('/#/p/f/tokF')
    await expect(page.locator('.public-view-title')).toHaveText('문서2')

    const topbarLogo = page.locator('.public-folder-topbar').getByRole('link', { name: `${brand.name} 열기` })
    await expect(topbarLogo).toBeVisible()
    await expect(page.getByRole('button', { name: '목록' })).toBeVisible()
  })

  test('400px 문서 링크 — 로고 글자 숨김, 아이콘 보임, 가로 스크롤 없음', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 })
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')

    const logo = page.getByRole('link', { name: `${brand.name} 열기` })
    await expect(logo.locator('img.brand-icon')).toBeVisible()
    await expect(logo.locator('span.brand')).not.toBeVisible()

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })
})

test.describe('F-215 A4 오류 화면', () => {
  test('폴더 링크 404 — 안내 문구와 로고 링크', async ({ page }) => {
    await page.route('**/pub/folders/*', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) }),
    )
    await page.goto('/#/p/f/badtok')
    await expect(page.locator('.public-view-notice')).toContainText('링크가 없거나 끊겼습니다.')
    await expect(page.getByRole('link', { name: `${brand.name} 열기` })).toBeVisible()
  })
})

// 공개 보기 위키링크 이동 — 문서 묶음 (specs/features/F-252.md 4장)
async function mockPublicSet(page, token, { start, list, others = {} }) {
  await page.route(`**/pub/docs/${token}/set`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) }),
  )
  await page.route(`**/pub/docs/${token}/docs/*`, (route) => {
    const url = new URL(route.request().url())
    const docId = url.pathname.split('/').pop()
    const doc = others[docId]
    if (!doc) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) })
  })
  await page.route(`**/pub/docs/${token}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(start) }),
  )
}

test.describe('F-252 C4 묶음 이동', () => {
  test('위키링크 클릭 → 해시 이동·문서 전환, 뒤로 가기로 시작 문서', async ({ page }) => {
    const token = 'tokSet1'
    await mockPublicSet(page, token, {
      start: { title: '문서A', content: '[[문서B]]\n', lineEnding: 'lf', updatedAt: 1 },
      list: { docs: [{ id: 'a1', title: '문서A' }, { id: 'b1', title: '문서B' }] },
      others: { b1: { title: '문서B', content: '# 문서B 본문\n', lineEnding: 'lf', updatedAt: 2 } },
    })
    await page.goto(`/#/p/${token}`)
    await expect(page.locator('.public-view-title')).toHaveText('문서A')

    const link = page.locator('a.wikilink', { hasText: '문서B' })
    await expect(link).toBeVisible()
    await link.click()

    await expect(page).toHaveURL(new RegExp(`#/p/${token}/b1$`))
    await expect(page.locator('.public-view-title')).toHaveText('문서B')

    await page.goBack()
    await expect(page.locator('.public-view-title')).toHaveText('문서A')
  })
})

// 버그 수정 회귀 테스트(2026-09-19): 경로 기반 공유 링크(`/p/{token}`, F-238)에서 위키링크로
// 들어간 뒤 뒤로 가면 App.tsx 의 hashchange 핸들러가 location.hash 만 보고 pathname 을
// 안 봐서 앱 홈으로 빠졌다
test.describe('경로 기반 공유 링크 뒤로 가기', () => {
  test('위키링크 클릭 → 뒤로 가기로 앱 홈이 아니라 시작 문서로', async ({ page }) => {
    const token = 'tokSet2Path'
    await mockPublicSet(page, token, {
      start: { title: '문서A', content: '[[문서B]]\n', lineEnding: 'lf', updatedAt: 1 },
      list: { docs: [{ id: 'a1', title: '문서A' }, { id: 'b1', title: '문서B' }] },
      others: { b1: { title: '문서B', content: '# 문서B 본문\n', lineEnding: 'lf', updatedAt: 2 } },
    })
    await page.goto(`/p/${token}`)
    await expect(page.locator('.public-view-title')).toHaveText('문서A')

    const link = page.locator('a.wikilink', { hasText: '문서B' })
    await expect(link).toBeVisible()
    await link.click()
    await expect(page.locator('.public-view-title')).toHaveText('문서B')

    await page.goBack()
    await expect(page.locator('.public-view-title')).toHaveText('문서A')
  })
})

test.describe('F-252 C5 묶음 밖 대상', () => {
  test('묶음에 없는 위키링크는 missing 스타일, 클릭해도 이동 없음', async ({ page }) => {
    const token = 'tokSet2'
    await mockPublicSet(page, token, {
      start: { title: '문서A', content: '[[없는문서]]\n\n[[문서B]]\n', lineEnding: 'lf', updatedAt: 1 },
      list: { docs: [{ id: 'a1', title: '문서A' }, { id: 'b1', title: '문서B' }] },
      others: { b1: { title: '문서B', content: '# 문서B\n', lineEnding: 'lf', updatedAt: 2 } },
    })
    await page.goto(`/#/p/${token}`)
    await expect(page.locator('.public-view-title')).toHaveText('문서A')

    const missing = page.locator('a.wikilink--missing')
    await expect(missing).toBeVisible()
    await missing.click()
    await expect(page.locator('.public-view-title')).toHaveText('문서A')
    await expect(page).toHaveURL(new RegExp(`#/p/${token}$`))
  })
})

test.describe('F-252 C6 단일 문서 링크', () => {
  test('묶음이 1개면 위키링크는 plain, 추가 문서 요청 없음', async ({ page }) => {
    const token = 'tokSet3'
    let otherDocRequested = false
    await page.route(`**/pub/docs/${token}/set`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ docs: [{ id: 'a1', title: '문서A' }] }) }),
    )
    await page.route(`**/pub/docs/${token}/docs/*`, (route) => {
      otherDocRequested = true
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) })
    })
    await page.route(`**/pub/docs/${token}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ title: '문서A', content: '[[문서B]]\n', lineEnding: 'lf', updatedAt: 1 }),
      }),
    )
    await page.goto(`/#/p/${token}`)
    await expect(page.locator('.public-view-title')).toHaveText('문서A')

    await expect(page.locator('span.wikilink--plain')).toBeVisible()
    await expect(page.locator('a.wikilink')).toHaveCount(0)
    expect(otherDocRequested).toBe(false)
  })
})

test.describe('F-252 C7 폴더 링크', () => {
  test('폴더 공개 보기 위키링크 클릭 → #/p/f/{t}/{id} 로 이동', async ({ page }) => {
    const folder = {
      name: '공유 폴더2',
      folders: [],
      docs: [
        { id: 'g1', title: '문서1', folderId: null, updatedAt: 100 },
        { id: 'g2', title: '문서2', folderId: null, updatedAt: 200 },
      ],
    }
    const docs = {
      g1: { title: '문서1', content: '# 문서1\n', lineEnding: 'lf', updatedAt: 100 },
      g2: { title: '문서2', content: '[[문서1]]\n', lineEnding: 'lf', updatedAt: 200 },
    }
    await mockPublicFolder(page, folder, docs)
    await page.goto('/#/p/f/tokF2')
    await expect(page.locator('.public-view-title')).toHaveText('문서2')

    const link = page.locator('a.wikilink', { hasText: '문서1' })
    await link.click()
    await expect(page).toHaveURL(/#\/p\/f\/tokF2\/g1$/)
    await expect(page.locator('.public-view-title')).toHaveText('문서1')
  })
})

test.describe('F-252 C8 별칭·섹션', () => {
  test('별칭은 보이는 글자, #절 뒤는 무시하고 대상으로 이동', async ({ page }) => {
    const token = 'tokSet4'
    await mockPublicSet(page, token, {
      start: { title: '문서A', content: '[[문서B|보이는글자]]\n\n[[문서B#절]]\n', lineEnding: 'lf', updatedAt: 1 },
      list: { docs: [{ id: 'a1', title: '문서A' }, { id: 'b1', title: '문서B' }] },
      others: { b1: { title: '문서B', content: '# 문서B\n', lineEnding: 'lf', updatedAt: 2 } },
    })
    await page.goto(`/#/p/${token}`)
    await expect(page.locator('.public-view-title')).toHaveText('문서A')

    await expect(page.locator('a.wikilink', { hasText: '보이는글자' })).toBeVisible()
    const sectionLink = page.locator('a.wikilink').filter({ hasText: /^문서B$/ })
    await expect(sectionLink).toBeVisible()
    await sectionLink.click()
    await expect(page).toHaveURL(new RegExp(`#/p/${token}/b1$`))
    await expect(page.locator('.public-view-title')).toHaveText('문서B')
  })
})

// 공유 화면 설정(테마·서체·글자 크기) F-230
test.describe('F-230 A1 버튼·대화상자', () => {
  test('설정 버튼 클릭 — 테마/제목 서체/본문 서체/글자 크기 4항목만, 들여쓰기·줄 번호 없음', async ({ page }) => {
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-title')).toHaveText(DOC.title)

    await page.getByRole('button', { name: '설정', exact: true }).click()
    const dialog = page.locator('dialog[aria-labelledby="settings-title"]')
    await expect(dialog).toBeVisible()
    const labels = dialog.locator('.dialog-field > span, .dialog-field [id]')
    await expect(labels).toHaveCount(4)
    await expect(labels.nth(0)).toHaveText('테마')
    await expect(labels.nth(1)).toHaveText('제목 서체')
    await expect(labels.nth(2)).toHaveText('본문 서체')
    await expect(labels.nth(3)).toHaveText('글자 크기')
    await expect(page.locator('#indent-label')).toHaveCount(0)
    await expect(page.locator('#line-numbers-label')).toHaveCount(0)
  })
})

test.describe('F-230 A2·A3 반영·저장', () => {
  test('테마를 다크로, 본문 서체를 세리프로 — 즉시 반영되고 새로고침 뒤에도 유지', async ({ page }) => {
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-title')).toHaveText(DOC.title)

    await page.getByRole('button', { name: '설정', exact: true }).click()
    const dialog = page.locator('dialog[aria-labelledby="settings-title"]')
    await dialog.locator('#theme-label').locator('..').getByRole('radio', { name: '다크' }).click()
    await dialog.locator('#body-font-label').locator('..').getByRole('radio', { name: '세리프', exact: true }).click()

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('html')).toHaveAttribute('data-body-font', 'serif')

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('html')).toHaveAttribute('data-body-font', 'serif')
  })
})

test.describe('F-230 A4 폴더 화면', () => {
  test('폴더 공개 보기 — 설정 버튼·대화상자·반영 동일', async ({ page }) => {
    await mockPublicFolder(page)
    await page.goto('/#/p/f/tokF')
    await expect(page.locator('.public-view-title')).toHaveText('문서2')

    await page.getByRole('button', { name: '설정', exact: true }).click()
    const dialog = page.locator('dialog[aria-labelledby="settings-title"]')
    await expect(dialog).toBeVisible()
    const labels = dialog.locator('.dialog-field > span, .dialog-field [id]')
    await expect(labels).toHaveCount(4)

    await dialog.locator('#theme-label').locator('..').getByRole('radio', { name: '다크' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })
})
