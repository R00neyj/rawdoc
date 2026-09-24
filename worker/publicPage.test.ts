// 공개 공유 링크 og/twitter 메타 동적 주입 (F-238.md 4장, F-272.md 7.1)
import { describe, expect, it } from 'vitest'
import { renderPublicPage } from './publicPage'
import { SITE_DESCRIPTION } from '../src/lib/siteMeta'
import brand from '../brand.config'
import { asD1, openTestDb } from './testD1'

type ShareLinkRow = {
  token: string
  owner_id: string
  target_type: 'doc' | 'folder'
  target_id: string
  revoked_at: number | null
}

type DocRow = { id: string; title: string; content: string }
type FolderRow = { id: string; name: string }

const SAMPLE_HTML = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <title>${brand.name}</title>
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${brand.name}" />
    <meta property="og:description" content="${SITE_DESCRIPTION}" />
    <meta property="og:url" content="https://rawdoc.app/" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${brand.name}" />
    <meta name="twitter:description" content="${SITE_DESCRIPTION}" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`

function makeEnv(opts: { links?: ShareLinkRow[]; docs?: DocRow[]; folders?: FolderRow[] } = {}) {
  const links = opts.links ?? []
  const docs = opts.docs ?? []
  const folders = opts.folders ?? []

  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.startsWith('SELECT * FROM share_links WHERE token')) {
                const [token] = args as [string]
                const row = links.find((l) => l.token === token && l.revoked_at === null)
                return (row ?? null) as T
              }
              if (sql.startsWith('SELECT title, content FROM docs WHERE id')) {
                const [id] = args as [string]
                const row = docs.find((d) => d.id === id)
                return (row ? { title: row.title, content: row.content } : null) as T
              }
              if (sql.startsWith('SELECT name FROM folders WHERE id')) {
                const [id] = args as [string]
                const row = folders.find((f) => f.id === id)
                return (row ? { name: row.name } : null) as T
              }
              throw new Error(`unhandled sql: ${sql}`)
            },
          }
        },
      }
    },
  }

  // 7.1 — /p/{token} 에는 자산이 없어 루트(/)를 명시적으로 받는다. 어느 URL 로 받았는지 기록한다
  const assetsRequests: string[] = []
  const ASSETS = {
    async fetch(input: RequestInfo | URL) {
      assetsRequests.push(input instanceof URL ? input.href : input.toString())
      return new Response(SAMPLE_HTML, { status: 200, headers: { 'content-type': 'text/html' } })
    },
  }

  return { env: { DB, ASSETS } as unknown as Env, assetsRequests }
}

function req(pathname: string): Request {
  return new Request(`http://local.test${pathname}`)
}

describe('F-238 renderPublicPage', () => {
  it('A1: 유효한 문서 토큰이면 og/twitter 제목·발췌를 채운다', async () => {
    const { env } = makeEnv({
      links: [{ token: 'a'.repeat(43), owner_id: 'u1', target_type: 'doc', target_id: 'd1', revoked_at: null }],
      docs: [{ id: 'd1', title: '내 문서', content: '본문 내용입니다' }],
    })
    const res = await renderPublicPage(req(`/p/${'a'.repeat(43)}`), env, `/p/${'a'.repeat(43)}`)
    expect(res).not.toBeNull()
    const html = await res!.text()
    expect(html).toContain(`property="og:title" content="내 문서 · ${brand.name}"`)
    expect(html).toContain('property="og:description" content="본문 내용입니다"')
    expect(html).toContain(`name="twitter:title" content="내 문서 · ${brand.name}"`)
    expect(html).toContain('name="twitter:description" content="본문 내용입니다"')
  })

  it('A1b (F-272 7.1): 자산은 요청 경로가 아니라 루트(/)로 받는다', async () => {
    const { env, assetsRequests } = makeEnv({
      links: [{ token: 'a'.repeat(43), owner_id: 'u1', target_type: 'doc', target_id: 'd1', revoked_at: null }],
      docs: [{ id: 'd1', title: '내 문서', content: '본문 내용입니다' }],
    })
    await renderPublicPage(req(`/p/${'a'.repeat(43)}`), env, `/p/${'a'.repeat(43)}`)
    expect(assetsRequests).toEqual(['http://local.test/'])
  })

  it('A2: 유효한 폴더 토큰이면 og:title 에 폴더 이름, description 은 SITE_DESCRIPTION', async () => {
    const token = 'b'.repeat(43)
    const { env } = makeEnv({
      links: [{ token, owner_id: 'u1', target_type: 'folder', target_id: 'f1', revoked_at: null }],
      folders: [{ id: 'f1', name: '내 폴더' }],
    })
    const res = await renderPublicPage(req(`/p/f/${token}`), env, `/p/f/${token}`)
    expect(res).not.toBeNull()
    const html = await res!.text()
    expect(html).toContain(`property="og:title" content="내 폴더 · ${brand.name}"`)
    expect(html).toContain(`property="og:description" content="${SITE_DESCRIPTION}"`)
  })

  it('A3: 존재하지 않는/폐기된/형식이 틀린 토큰이면 null', async () => {
    const revokedToken = 'c'.repeat(43)
    const { env } = makeEnv({
      links: [{ token: revokedToken, owner_id: 'u1', target_type: 'doc', target_id: 'd1', revoked_at: Date.now() }],
      docs: [{ id: 'd1', title: '문서', content: '내용' }],
    })
    expect(await renderPublicPage(req(`/p/${revokedToken}`), env, `/p/${revokedToken}`)).toBeNull()
    expect(await renderPublicPage(req('/p/nope'), env, '/p/nope')).toBeNull()
    expect(await renderPublicPage(req(`/p/${'d'.repeat(43)}`), env, `/p/${'d'.repeat(43)}`)).toBeNull()
  })

  it('A4: 제목·본문에 <script>, ", & 가 있으면 이스케이프된다', async () => {
    const token = 'e'.repeat(43)
    const { env } = makeEnv({
      links: [{ token, owner_id: 'u1', target_type: 'doc', target_id: 'd1', revoked_at: null }],
      docs: [{ id: 'd1', title: '<script>alert(1)</script>&"', content: '본문' }],
    })
    const res = await renderPublicPage(req(`/p/${token}`), env, `/p/${token}`)
    const html = await res!.text()
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;')
  })

  it('A5: 본문이 100자 초과면 100자로 자르고 말줄임표', async () => {
    const token = 'f'.repeat(43)
    const long = 'a'.repeat(150)
    const { env } = makeEnv({
      links: [{ token, owner_id: 'u1', target_type: 'doc', target_id: 'd1', revoked_at: null }],
      docs: [{ id: 'd1', title: '문서', content: long }],
    })
    const res = await renderPublicPage(req(`/p/${token}`), env, `/p/${token}`)
    const html = await res!.text()
    expect(html).toContain(`property="og:description" content="${'a'.repeat(100)}…"`)
  })

  it('A6: 본문이 빈 문자열이거나 주석만 있으면 SITE_DESCRIPTION 폴백', async () => {
    const token = 'g'.repeat(43)
    const { env } = makeEnv({
      links: [{ token, owner_id: 'u1', target_type: 'doc', target_id: 'd1', revoked_at: null }],
      docs: [{ id: 'd1', title: '문서', content: '<!-- 주석만 있음 -->' }],
    })
    const res = await renderPublicPage(req(`/p/${token}`), env, `/p/${token}`)
    const html = await res!.text()
    expect(html).toContain(`property="og:description" content="${SITE_DESCRIPTION}"`)
  })

  it('A7: /p/f/:token/extra 처럼 세그먼트가 더 있으면 null', async () => {
    const token = 'h'.repeat(43)
    const { env } = makeEnv({
      links: [{ token, owner_id: 'u1', target_type: 'folder', target_id: 'f1', revoked_at: null }],
      folders: [{ id: 'f1', name: '폴더' }],
    })
    expect(await renderPublicPage(req(`/p/f/${token}/extra`), env, `/p/f/${token}/extra`)).toBeNull()
  })

  it('A8: 응답 헤더에 X-Robots-Tag: noindex 포함', async () => {
    const token = 'i'.repeat(43)
    const { env } = makeEnv({
      links: [{ token, owner_id: 'u1', target_type: 'doc', target_id: 'd1', revoked_at: null }],
      docs: [{ id: 'd1', title: '문서', content: '내용' }],
    })
    const res = await renderPublicPage(req(`/p/${token}`), env, `/p/${token}`)
    expect(res!.headers.get('X-Robots-Tag')).toBe('noindex')
  })
})

describe('F-2028 P1 막힌 소유자의 링크는 메타를 주입하지 않는다', () => {
  it('막힘이면 두 주소 모두 null, 풀면 다시 제목·폴더 이름', async () => {
    const db = openTestDb()
    db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('u1', 'u1@example.com', 1)
    db.prepare(
      "INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, pinned_at, version, created_at, updated_at) VALUES ('d1', 'u1', '막힌 문서', '본문', 'lf', NULL, NULL, 1, 1, 1)",
    ).run()
    db.prepare("INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at) VALUES ('f1', 'u1', '막힌 폴더', NULL, 1, 1)").run()
    const docToken = 'p'.repeat(43)
    const folderToken = 'q'.repeat(43)
    const link = db.prepare('INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?, ?, ?, ?, 1, NULL)')
    link.run(docToken, 'u1', 'doc', 'd1')
    link.run(folderToken, 'u1', 'folder', 'f1')
    const ASSETS = { async fetch() { return new Response(SAMPLE_HTML, { status: 200, headers: { 'content-type': 'text/html' } }) } }
    const env = { DB: asD1(db), ASSETS } as unknown as Env
    const docPath = `/p/${docToken}`
    const folderPath = `/p/f/${folderToken}`

    db.prepare('UPDATE users SET blocked_at = ? WHERE id = ?').run(123, 'u1')
    expect(await renderPublicPage(req(docPath), env, docPath)).toBeNull()
    expect(await renderPublicPage(req(folderPath), env, folderPath)).toBeNull()

    db.prepare('UPDATE users SET blocked_at = NULL WHERE id = ?').run('u1')
    const docPage = await renderPublicPage(req(docPath), env, docPath)
    const folderPage = await renderPublicPage(req(folderPath), env, folderPath)
    expect(docPage).toBeInstanceOf(Response)
    expect(folderPage).toBeInstanceOf(Response)
    expect(await docPage!.text()).toContain(`property="og:title" content="막힌 문서 · ${brand.name}"`)
    expect(await folderPage!.text()).toContain(`property="og:title" content="막힌 폴더 · ${brand.name}"`)
  })
})
