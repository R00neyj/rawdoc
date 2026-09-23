// 공개 보기 화면 S-5 (specs/features/F-210.md 2.4·2.5)
import { test, expect } from '@playwright/test'
import brand from '../brand.config.ts'
import { openApp, importMarkdown } from './helpers.js'

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
    const toggle = page.getByRole('button', { name: '문서 목록 열기' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(page.locator('.public-folder-list')).toBeVisible()
    await expect(page.getByRole('button', { name: '문서 목록 닫기' })).toHaveAttribute('aria-expanded', 'true')
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
    await expect(page.getByRole('button', { name: '문서 목록 열기' })).toBeVisible()
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

// 공유 화면을 앱 디자인 문법에 맞춘다 (specs/features/F-293.md)
test.describe('F-293 A2 머리줄 버튼 모양', () => {
  test('아이콘 버튼 2개 — 글자 없이 svg 1개, aria-label 설정·.md 내보내기', async ({ page }) => {
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-title')).toHaveText(DOC.title)

    const buttons = page.locator('.public-view-header .icon-btn')
    await expect(buttons).toHaveCount(2)
    await expect(buttons.nth(0)).toHaveAttribute('aria-label', '설정')
    await expect(buttons.nth(1)).toHaveAttribute('aria-label', '.md 내보내기')
    for (const i of [0, 1]) {
      await expect(buttons.nth(i)).toHaveText('')
      await expect(buttons.nth(i).locator('svg')).toHaveCount(1)
    }
  })
})

test.describe('F-293 A3 툴팁', () => {
  test('호버는 400ms 지연 뒤, 포커스는 지연 없이 뜬다', async ({ page }) => {
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-title')).toHaveText(DOC.title)

    for (const label of ['설정', '.md 내보내기']) {
      const btn = page.locator(`.public-view-header .icon-btn[aria-label="${label}"]`)
      const wrap = page.locator(`.public-view-header .icon-btn-wrap:has(.icon-btn[aria-label="${label}"])`)
      const tooltip = wrap.locator('.icon-tooltip')

      await btn.hover()
      const hoverDelay = await tooltip.evaluate((el) => getComputedStyle(el).transitionDelay)
      expect(hoverDelay).toBe('0.4s')
      await page.waitForTimeout(600)
      await expect(tooltip).toHaveCSS('opacity', '1')
      await expect(tooltip).toHaveText(label)

      await page.mouse.move(10, 10)
      await expect(tooltip).toHaveCSS('opacity', '0')

      await btn.focus()
      const focusDelay = await tooltip.evaluate((el) => getComputedStyle(el).transitionDelay)
      expect(focusDelay).toBe('0s')
      await expect(tooltip).toHaveCSS('opacity', '1', { timeout: 300 })
      await btn.blur()
    }
  })
})

test.describe('F-293 A4 좁은 창에서 툴팁이 창 밖으로 안 나감', () => {
  test('1280×800·400×800 두 버튼 모두', async ({ page }) => {
    await mockPublicDoc(page)
    for (const width of [1280, 400]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/#/p/tok123')
      await expect(page.locator('.public-view-title')).toHaveText(DOC.title)

      for (const label of ['설정', '.md 내보내기']) {
        const btn = page.locator(`.public-view-header .icon-btn[aria-label="${label}"]`)
        const wrap = page.locator(`.public-view-header .icon-btn-wrap:has(.icon-btn[aria-label="${label}"])`)
        const tooltip = wrap.locator('.icon-tooltip')
        await btn.hover()
        await page.waitForTimeout(600)
        const box = await tooltip.evaluate((el) => {
          const r = el.getBoundingClientRect()
          return { left: r.left, right: r.right }
        })
        expect(box.right).toBeLessThanOrEqual(width)
        expect(box.left).toBeGreaterThanOrEqual(0)
        await page.mouse.move(10, 10)
      }

      const scrollWidth = await page.evaluate(() => document.scrollingElement.scrollWidth)
      const clientWidth = await page.evaluate(() => document.scrollingElement.clientWidth)
      expect(scrollWidth).toBe(clientWidth)
    }
  })
})

test.describe('F-293 A5 설정 동작 (회귀)', () => {
  test('새 설정 버튼 클릭 — 대화상자가 뜬다', async ({ page }) => {
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-title')).toHaveText(DOC.title)

    await page.getByRole('button', { name: '설정', exact: true }).click()
    await expect(page.locator('dialog[aria-labelledby="settings-title"]')).toBeVisible()
  })
})

test.describe('F-293 A6 내보내기 동작·비활성 (회귀)', () => {
  test('문서 로딩 중엔 비활성, 뜬 뒤 클릭하면 응답 바이트 그대로 받는다', async ({ page }) => {
    let resolveRoute
    await page.route('**/pub/docs/tok123/set', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ docs: [] }) }),
    )
    await page.route('**/pub/docs/tok123', async (route) => {
      await new Promise((resolve) => {
        resolveRoute = () => {
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DOC) })
          resolve()
        }
      })
    })
    await page.goto('/#/p/tok123')

    const exportBtn = page.getByRole('button', { name: '.md 내보내기' })
    await expect(exportBtn).toBeDisabled()

    resolveRoute()
    await expect(page.locator('.public-view-title')).toHaveText(DOC.title)
    await expect(exportBtn).toBeEnabled()

    const [download] = await Promise.all([page.waitForEvent('download'), exportBtn.click()])
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString('utf-8')).toBe(DOC.content)
  })
})

test.describe('F-293 A7 좁은 창 목록 토글', () => {
  test('900px — aria-label·aria-expanded 가 상태를 따라 바뀐다', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 })
    await mockPublicFolder(page)
    await page.goto('/#/p/f/tokF')
    await expect(page.locator('.public-view-title')).toHaveText('문서2')

    const openBtn = page.getByRole('button', { name: '문서 목록 열기' })
    await expect(openBtn).toHaveAttribute('aria-expanded', 'false')

    await openBtn.click()
    const closeBtn = page.getByRole('button', { name: '문서 목록 닫기' })
    await expect(closeBtn).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.public-folder-list')).toBeVisible()

    // .public-folder-backdrop(fixed, z-index:19)가 뷰포트 전체를 덮어 토글 버튼 클릭을 가로챈다(F-293 이전부터 있던 레이어링) — force 로 버튼 자체의 onClick 을 확인한다
    await closeBtn.click({ force: true })
    await expect(page.getByRole('button', { name: '문서 목록 열기' })).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.public-folder-list')).toHaveCount(0)
  })
})

test.describe('F-293 A8 머리줄 구조', () => {
  test('.md-code > .md-code-head(언어+복사버튼) + pre, pre 안에는 복사 버튼이 없다', async ({ page }) => {
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-title')).toHaveText(DOC.title)

    const mdCode = page.locator('.viewer .md-code')
    await expect(mdCode).toHaveCount(1)
    const head = mdCode.locator('.md-code-head')
    await expect(head).toHaveCount(1)
    await expect(head.locator('.md-code-lang')).toHaveText('JavaScript')
    await expect(head.locator('.code-copy-btn')).toHaveCount(1)
    const pre = mdCode.locator('pre')
    await expect(pre).toHaveCount(1)
    await expect(pre.locator('.code-copy-btn')).toHaveCount(0)

    const headBox = await head.evaluate((el) => el.getBoundingClientRect())
    const preBox = await pre.evaluate((el) => el.getBoundingClientRect())
    expect(headBox.bottom).toBeLessThanOrEqual(preBox.top)
  })
})

test.describe('F-293 A9 머리줄 복사 (회귀)', () => {
  test('누르면 클립보드에 원문이 담기고 아이콘이 바뀐다', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')

    const btn = page.locator('.md-code .md-code-head .code-copy-btn')
    await expect(btn).toBeVisible()
    await btn.click()

    const clip = await page.evaluate(() => navigator.clipboard.readText())
    const expectedCode = /```js\n([\s\S]*?)\n```/.exec(DOC.content)[1]
    expect(clip.trim()).toBe(expectedCode)
    await expect(btn.locator('svg')).toBeVisible()
  })
})

test.describe('F-293 A10 언어 없는 코드블록', () => {
  test('머리줄엔 복사 버튼만, 언어 이름 없음', async ({ page }) => {
    const doc = { ...DOC, content: '본문\n\n```\nplain text\n```\n' }
    await mockPublicDoc(page, doc)
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-title')).toHaveText(DOC.title)

    const head = page.locator('.viewer .md-code .md-code-head')
    await expect(head).toHaveCount(1)
    await expect(head.locator('.md-code-lang')).toHaveCount(0)
    await expect(head.locator('.code-copy-btn')).toHaveCount(1)
  })
})

test.describe('F-293 A11 도움말 화면 머리줄 (회귀)', () => {
  test('#/help — 머리줄이 하나 이상 생긴다', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '도움말' }).first().click()
    await expect(page.locator('.help-page')).toBeVisible()
    await expect(page.locator('.help-page .md-code-head')).not.toHaveCount(0)
  })
})

test.describe('F-293 A14 앱 보기 모드 불변', () => {
  test('코드블록이 있어도 .viewer 에 머리줄·복사 버튼이 없다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '```js\nalert(1)\n```\n' })

    await page.getByRole('button', { name: '보기 — 읽기 전용으로 보기' }).click()
    await expect(page.locator('.viewer .markdown-body pre')).toBeVisible()
    await expect(page.locator('.viewer .md-code-head')).toHaveCount(0)
    await expect(page.locator('.viewer .code-copy-btn')).toHaveCount(0)
  })
})
