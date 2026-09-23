// 공개 공유 링크(/p/:token, /p/f/:token) 요청에 og/twitter 메타를 문서·폴더별로 주입 (F-238.md 3장)
import { isValidToken } from './token'
import { stripComments } from '../src/lib/comments'
import { SITE_DESCRIPTION } from '../src/lib/siteMeta'
import brand from '../brand.config'

type LinkRow = {
  token: string
  owner_id: string
  target_type: 'doc' | 'folder'
  target_id: string
  revoked_at: number | null
}

const DOC_PATH_RE = /^\/p\/([^/]+)$/
const FOLDER_PATH_RE = /^\/p\/f\/([^/]+)$/

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 개행·연속 공백을 단일 스페이스로 접고 100자 초과 시 말줄임표
function excerpt(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= 100) return collapsed
  return `${collapsed.slice(0, 100)}…`
}

// attrName="attrValue" 를 가진 <meta ...> 태그를 찾아 그 안의 content 값만 치환한다
function replaceMetaContent(html: string, attrName: string, attrValue: string, newContent: string): string {
  const tagRe = new RegExp(`<meta[^>]*\\b${attrName}="${attrValue}"[^>]*>`, 'i')
  const match = tagRe.exec(html)
  if (!match) return html
  const tag = match[0]
  const newTag = tag.replace(/content="[^"]*"/, `content="${newContent}"`)
  return html.slice(0, match.index) + newTag + html.slice(match.index + tag.length)
}

function injectMeta(html: string, meta: { title: string; description: string }): string {
  const title = escapeHtml(meta.title)
  const description = escapeHtml(meta.description)
  let out = html
  out = replaceMetaContent(out, 'property', 'og:title', title)
  out = replaceMetaContent(out, 'property', 'og:description', description)
  out = replaceMetaContent(out, 'name', 'twitter:title', title)
  out = replaceMetaContent(out, 'name', 'twitter:description', description)
  return out
}

export async function renderPublicPage(request: Request, env: Env, pathname: string): Promise<Response | null> {
  try {
    const folderMatch = FOLDER_PATH_RE.exec(pathname)
    const docMatch = folderMatch ? null : DOC_PATH_RE.exec(pathname)
    if (!folderMatch && !docMatch) return null

    const targetType: 'doc' | 'folder' = folderMatch ? 'folder' : 'doc'
    const token = (folderMatch ?? docMatch)![1]
    if (!isValidToken(token)) return null

    const link = await env.DB.prepare('SELECT * FROM share_links WHERE token = ? AND revoked_at IS NULL')
      .bind(token)
      .first<LinkRow>()
    if (!link || link.target_type !== targetType) return null

    let title: string
    let description: string
    if (targetType === 'doc') {
      const doc = await env.DB.prepare('SELECT title, content FROM docs WHERE id = ?')
        .bind(link.target_id)
        .first<{ title: string; content: string }>()
      if (!doc) return null
      title = `${doc.title} · ${brand.name}`
      const excerptText = excerpt(stripComments(doc.content))
      description = excerptText || SITE_DESCRIPTION
    } else {
      const folder = await env.DB.prepare('SELECT name FROM folders WHERE id = ?')
        .bind(link.target_id)
        .first<{ name: string }>()
      if (!folder) return null
      title = `${folder.name} · ${brand.name}`
      description = SITE_DESCRIPTION
    }

    // 자산에는 /p/{token} 자체가 없다 — 루트 자산(index.html)을 명시적으로 받는다. /index.html 로 받으면 301 한다 (F-272.md 7.1)
    const base = await env.ASSETS.fetch(new URL('/', request.url))
    const html = await base.text()
    const injected = injectMeta(html, { title, description })
    const headers = new Headers(base.headers)
    headers.set('content-type', 'text/html; charset=utf-8')
    headers.set('X-Robots-Tag', 'noindex')
    return new Response(injected, { status: base.status, headers })
  } catch (err) {
    console.error(err)
    return null
  }
}
