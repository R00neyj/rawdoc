// F-206 API 를 page.route 로 메모리에서 흉내낸다 (specs/features/F-207.md 1장 파일 소유)
// F-209 2.3·2.4: /api/attachments 올리기·받기도 메모리로 흉내낸다
import crypto from 'node:crypto'

const ATTACHMENT_MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

// 로그인 상태로 /api/me·/api/docs·/api/folders 를 흉내낸다
export async function fakeServer(page, { id = 'u1', email = 'a@b.com' } = {}) {
  const docs = new Map()
  const folders = new Map()
  const attachments = new Map() // key `${id}.${ext}` -> { mime, bytes, width, height }
  // F-243 공유 관리 — 링크·권한을 흉내낸다. 대상마다 살아있는 링크 최대 1개 (worker/links.ts 와 같은 규칙)
  const shareLinks = new Map() // key `${targetType}:${targetId}` -> { token, createdAt, revokedAt }
  const grants = new Map() // key `${targetType}:${targetId}:${email}` -> { role, createdAt }
  // context.setOffline() 은 page.route 가 먼저 가로채 못 걸러낸다 — 이 플래그로 직접 흉내낸다 (F-207 A4)
  let offline = false
  // 계정당 이미지 저장 한도 흉내 (F-221 2.2·2.5)
  let usage = { used: 0, limit: 314_572_800 }
  // 로그인 상태 플래그와 /api/auth/sign-out 흉내 (F-2034 7장)
  let loggedIn = true
  let signOutFailureMode = null // null | 'network' | number
  let signOutRequestCount = 0
  // F-2030 3.6 — /api/me 응답에 합칠 조각(blocked·warned 등), 쓰기 실패 조종, 쓰기 요청 기록
  let mePatch = {}
  let writeRule = null // null | { status, body?, headers?, times?, match? }
  const writeLog = []
  // 금고 키 묶음 흉내 (F-404 10.3) — 없으면 null, 있으면 { bundle, rev }
  let e2eeKeys = null
  // 옮기기 응답의 purged 를 false 로 (F-407 9.3)
  let purgeFails = false

  function docSummary(d) {
    const { content: _content, ...rest } = d
    return rest
  }

  // 쓰기 경로의 GET 아닌 요청을 기록하고, writeRule 이 걸리면 그 응답으로 route 를 끝낸다 (F-2030 3.6)
  function recordWrite(route, req) {
    const path = new URL(req.url()).pathname
    writeLog.push({ method: req.method(), path, at: Date.now() })
    if (!writeRule) return false
    if (writeRule.times !== undefined && writeRule.times <= 0) return false
    if (writeRule.match && !writeRule.match({ method: req.method(), path, body: safePostDataJSON(req) })) return false
    const { status, body, headers } = writeRule
    if (writeRule.times !== undefined) {
      writeRule.times -= 1
      if (writeRule.times <= 0) writeRule = null
    }
    route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body ?? {}) })
    return true
  }

  function safePostDataJSON(req) {
    try {
      return req.postDataJSON()
    } catch {
      return undefined
    }
  }

  await page.route('**/api/me', (route) => {
    if (!loggedIn) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, email, ...mePatch }) })
  })

  // POST /api/auth/sign-out — 로그아웃 흉내 (F-2034 7장). GET 등은 다른 경로로 넘긴다
  await page.route('**/api/auth/sign-out', (route) => {
    const req = route.request()
    if (req.method() !== 'POST') return route.fallback()
    signOutRequestCount += 1
    if (offline) return route.abort('internetdisconnected')
    if (signOutFailureMode === 'network') return route.abort('failed')
    if (typeof signOutFailureMode === 'number') {
      return route.fulfill({ status: signOutFailureMode, contentType: 'application/json', body: '{"error":"internal"}' })
    }
    loggedIn = false
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
  })

  await page.route('**/api/docs', async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    if (req.method() === 'GET') {
      const list = [...docs.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(docSummary)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) })
    }
    if (req.method() === 'POST') {
      if (recordWrite(route, req)) return
      const body = req.postDataJSON()
      if (body.id && docs.has(body.id)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(docs.get(body.id)) })
      }
      // 금고 판정 (F-405 9.3, worker/docs.ts handleCreateDoc 과 같은 409)
      if (body.e2eeKey && !e2eeKeys) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'no_vault' }) })
      if (!body.e2eeKey && body.folderId && folders.get(body.folderId)?.e2ee) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'e2ee_folder' }) })
      const now = Date.now()
      // createdAt·updatedAt·pinnedAt 이 오면 그대로 쓴다 — 로컬 이관이 원본 시각을 유지한다 (F-208 2.3, worker/docs.ts 와 동일)
      const doc = {
        id: body.id || crypto.randomUUID(),
        title: body.title,
        content: body.content,
        lineEnding: body.lineEnding,
        folderId: body.folderId ?? null,
        pinnedAt: body.pinnedAt === undefined ? null : body.pinnedAt,
        version: 1,
        createdAt: typeof body.createdAt === 'number' ? body.createdAt : now,
        updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : now,
        ...(body.e2eeKey ? { e2eeKey: body.e2eeKey, attachmentRefs: body.attachmentRefs ?? [] } : {}),
      }
      docs.set(doc.id, doc)
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(doc) })
    }
    return route.fallback()
  })

  await page.route(/\/api\/docs\/[^/]+$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    const id = decodeURIComponent(new URL(req.url()).pathname.split('/').pop())
    const doc = docs.get(id)
    if (req.method() === 'GET') {
      if (!doc) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) })
    }
    if (req.method() === 'PUT') {
      if (recordWrite(route, req)) return
      if (!doc) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
      const body = req.postDataJSON()
      if (typeof body.content === 'string' && Buffer.byteLength(body.content, 'utf-8') > 1_000_000) {
        return route.fulfill({
          status: 413,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'too_large', limit: 1_000_000 }),
        })
      }
      // 표지 대조는 버전 검사보다 앞 (F-401 3.3 7번)
      if (doc.e2eeKey && body.e2ee !== true) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'e2ee_doc' }) })
      if (!doc.e2eeKey && body.e2ee === true) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'not_e2ee' }) })
      if (doc.e2eeKey && Array.isArray(body.attachmentRefs)) doc.attachmentRefs = body.attachmentRefs
      if (body.baseVersion !== doc.version) {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'conflict', doc }),
        })
      }
      if (body.title !== undefined) doc.title = body.title
      if (body.content !== undefined) doc.content = body.content
      doc.version += 1
      doc.updatedAt = Date.now()
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) })
    }
    if (req.method() === 'DELETE') {
      if (recordWrite(route, req)) return
      docs.delete(id)
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })

  // PUT /api/docs/:id/e2ee — 금고로 옮기기·빼기 (F-401 3.4 판정, F-407 9.3)
  await page.route(/\/api\/docs\/[^/]+\/e2ee$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    if (req.method() !== 'PUT') return route.fallback()
    if (recordWrite(route, req)) return
    const id = decodeURIComponent(new URL(req.url()).pathname.split('/').slice(-2, -1)[0])
    const doc = docs.get(id)
    if (!doc) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
    const body = req.postDataJSON()
    const conflict = (error) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error }) })
    const toE2ee = typeof body.e2eeKey === 'string'
    if (toE2ee && doc.e2eeKey) return conflict('e2ee_doc')
    if (!toE2ee && !doc.e2eeKey) return conflict('not_e2ee')
    if (!toE2ee && doc.folderId && folders.get(doc.folderId)?.e2ee) return conflict('e2ee_folder')
    if (toE2ee && !e2eeKeys) return conflict('no_vault')
    if (body.baseVersion !== doc.version) {
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'conflict', doc }) })
    }
    doc.title = body.title
    doc.content = body.content
    if (toE2ee) {
      doc.e2eeKey = body.e2eeKey
      doc.attachmentRefs = Array.isArray(body.attachmentRefs) ? body.attachmentRefs : []
      const link = shareLinks.get(`doc:${id}`)
      if (link && !link.revokedAt) link.revokedAt = Date.now()
    } else {
      delete doc.e2eeKey
      delete doc.attachmentRefs
    }
    doc.version += 1
    doc.updatedAt = Date.now()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...doc, purged: !purgeFails }) })
  })

  await page.route(/\/api\/docs\/[^/]+\/folder$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    if (recordWrite(route, req)) return
    const id = decodeURIComponent(new URL(req.url()).pathname.split('/').slice(-2, -1)[0])
    const doc = docs.get(id)
    if (!doc) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
    const body = req.postDataJSON()
    if (!doc.e2eeKey && body.folderId && folders.get(body.folderId)?.e2ee) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'e2ee_folder' }) })
    doc.folderId = body.folderId
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) })
  })

  await page.route(/\/api\/docs\/[^/]+\/pin$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    if (recordWrite(route, req)) return
    const id = decodeURIComponent(new URL(req.url()).pathname.split('/').slice(-2, -1)[0])
    const doc = docs.get(id)
    if (!doc) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
    const body = req.postDataJSON()
    doc.pinnedAt = body.pinned ? Date.now() : null
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) })
  })

  await page.route('**/api/folders', async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    if (req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([...folders.values()]) })
    }
    if (req.method() === 'POST') {
      if (recordWrite(route, req)) return
      const body = req.postDataJSON()
      if (body.e2ee !== true && body.parentId && folders.get(body.parentId)?.e2ee) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'e2ee_folder' }) })
      const now = Date.now()
      const folder = { id: body.id || crypto.randomUUID(), name: body.name, parentId: body.parentId ?? null, createdAt: now, updatedAt: now, ...(body.e2ee === true ? { e2ee: true } : {}) }
      folders.set(folder.id, folder)
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(folder) })
    }
    return route.fallback()
  })

  await page.route(/\/api\/folders\/[^/]+$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    const id = decodeURIComponent(new URL(req.url()).pathname.split('/').pop())
    const folder = folders.get(id)
    if (req.method() === 'PUT') {
      if (recordWrite(route, req)) return
      if (!folder) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
      const body = req.postDataJSON()
      if (!folder.e2ee && body.parentId && folders.get(body.parentId)?.e2ee) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'e2ee_folder' }) })
      // 금고 표지 켜기·끄기 (F-401 5.2, F-407 9.3)
      if (body.e2ee === true && !folder.e2ee) {
        const plainDocs = [...docs.values()].filter((d) => d.folderId === id && !d.e2eeKey).length
        const plainFolders = [...folders.values()].filter((f) => f.parentId === id && !f.e2ee).length
        if (plainDocs > 0 || plainFolders > 0) {
          return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'e2ee_folder_not_ready', docs: plainDocs, folders: plainFolders }) })
        }
        folder.e2ee = true
      } else if (body.e2ee === false && folder.e2ee) {
        if (folder.parentId && folders.get(folder.parentId)?.e2ee) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'e2ee_folder' }) })
        delete folder.e2ee
      }
      if (body.name !== undefined) folder.name = body.name
      if (body.parentId !== undefined) folder.parentId = body.parentId
      folder.updatedAt = Date.now()
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(folder) })
    }
    if (req.method() === 'DELETE') {
      if (recordWrite(route, req)) return
      folders.delete(id)
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })

  // PUT·GET·DELETE /api/attachments/:id.:ext — 실제 서버 판정 없이 확장자를 그대로 믿는다(F-209 2.3·2.4 흉내). 경로 정규식은 쿼리(?e2ee=1&w=&h=)도 허용한다(F-406 7.3)
  await page.route(/\/api\/attachments\/[0-9a-f]{16}\.(png|jpg|gif|webp)(\?.*)?$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    const reqUrl = new URL(req.url())
    const name = reqUrl.pathname.split('/').pop()
    const m = /^([0-9a-f]{16})\.(png|jpg|gif|webp)$/.exec(name)
    const [, attId, ext] = m
    const key = `${attId}.${ext}`

    if (req.method() === 'PUT') {
      const e2ee = reqUrl.searchParams.get('e2ee') === '1'
      const existing = attachments.get(key)
      if (existing) {
        if (Boolean(existing.e2ee) !== e2ee) {
          return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'e2ee_mismatch' }) })
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: attId,
            ext,
            mime: existing.mime,
            size: existing.bytes.length,
            width: existing.width,
            height: existing.height,
            ...(existing.e2ee ? { e2ee: true } : {}),
          }),
        })
      }
      const bytes = req.postDataBuffer() ?? Buffer.alloc(0)
      if (e2ee) {
        const wRaw = reqUrl.searchParams.get('w')
        const hRaw = reqUrl.searchParams.get('h')
        const dimRe = /^[1-9][0-9]{0,7}$/
        if (!dimRe.test(wRaw ?? '') || !dimRe.test(hRaw ?? '')) {
          return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid', field: !dimRe.test(wRaw ?? '') ? 'w' : 'h' }) })
        }
        if (bytes.length < 69 || bytes[0] !== 1) {
          return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid', field: 'body' }) })
        }
        if (usage.used + bytes.length > usage.limit) {
          return route.fulfill({
            status: 507,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'quota_exceeded', used: usage.used, limit: usage.limit }),
          })
        }
        const mime = ATTACHMENT_MIME[ext]
        const width = Number(wRaw)
        const height = Number(hRaw)
        const record = { mime, bytes, width, height, e2ee: true }
        attachments.set(key, record)
        usage = { ...usage, used: usage.used + bytes.length }
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: attId, ext, mime, size: bytes.length, width, height, e2ee: true }),
        })
      }
      if (usage.used + bytes.length > usage.limit) {
        return route.fulfill({
          status: 507,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'quota_exceeded', used: usage.used, limit: usage.limit }),
        })
      }
      const mime = ATTACHMENT_MIME[ext]
      const record = { mime, bytes, width: 2, height: 2 }
      attachments.set(key, record)
      usage = { ...usage, used: usage.used + bytes.length }
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: attId, ext, mime, size: bytes.length, width: record.width, height: record.height }),
      })
    }
    if (req.method() === 'GET') {
      const record = attachments.get(key)
      if (!record) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
      return route.fulfill({ status: 200, contentType: record.e2ee ? 'application/octet-stream' : record.mime, body: record.bytes })
    }
    if (req.method() === 'DELETE') {
      if (!attachments.has(key)) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
      const inUse = [...docs.values()].some(
        (d) => d.content.includes(`attachments/${attId}.`) || (Array.isArray(d.attachmentRefs) && d.attachmentRefs.includes(attId)),
      )
      if (inUse) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'in_use' }) })
      const removed = attachments.get(key)
      attachments.delete(key)
      usage = { ...usage, used: Math.max(0, usage.used - removed.bytes.length) }
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })

  await page.route('**/api/usage', async (route) => {
    if (offline) return route.abort('internetdisconnected')
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(usage) })
  })

  // GET·POST /api/tokens, DELETE /api/tokens/:id 를 메모리로 흉내낸다 (F-222 2.2)
  const apiTokens = new Map()
  await page.route('**/api/tokens', async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    if (req.method() === 'GET') {
      const list = [...apiTokens.values()]
        .filter((t) => !t.revokedAt)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(({ id, name, prefix, createdAt, lastUsedAt }) => ({ id, name, prefix, createdAt, lastUsedAt }))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) })
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON()
      const trimmed = typeof body.name === 'string' ? body.name.trim() : ''
      if (!trimmed || trimmed.length > 40) {
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid', field: 'name' }) })
      }
      const activeCount = [...apiTokens.values()].filter((t) => !t.revokedAt).length
      if (activeCount >= 10) {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'too_many', limit: 10 }) })
      }
      const id = crypto.randomUUID()
      const token = `rd_${id.replace(/-/g, '')}`
      const record = { id, name: trimmed, prefix: token.slice(0, 11), createdAt: Date.now(), lastUsedAt: null, revokedAt: null }
      apiTokens.set(id, record)
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: record.id, name: record.name, prefix: record.prefix, createdAt: record.createdAt, lastUsedAt: null, token }),
      })
    }
    return route.fallback()
  })

  await page.route(/\/api\/tokens\/[^/]+$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    if (req.method() !== 'DELETE') return route.fallback()
    const id = decodeURIComponent(new URL(req.url()).pathname.split('/').pop())
    const record = apiTokens.get(id)
    if (!record) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
    record.revokedAt = Date.now()
    return route.fulfill({ status: 204 })
  })

  // GET·POST·DELETE /api/(docs|folders)/:id/link — 읽기 전용 링크 (F-210·F-211)
  await page.route(/\/api\/(docs|folders)\/[^/]+\/link$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    const parts = new URL(req.url()).pathname.split('/')
    parts.pop() // 'link'
    const targetId = decodeURIComponent(parts.pop())
    const targetType = parts.pop() === 'folders' ? 'folder' : 'doc'
    const key = `${targetType}:${targetId}`
    const existing = shareLinks.get(key)

    if (req.method() === 'GET') {
      if (!existing || existing.revokedAt) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no_link"}' })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: existing.token }) })
    }
    if (req.method() === 'POST') {
      if (existing && !existing.revokedAt) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: existing.token }) })
      }
      const record = { token: crypto.randomUUID().replace(/-/g, ''), createdAt: Date.now(), revokedAt: null }
      shareLinks.set(key, record)
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ token: record.token }) })
    }
    if (req.method() === 'DELETE') {
      if (existing) existing.revokedAt = Date.now()
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })

  // GET·PUT·DELETE /api/(docs|folders)/:id/grants(/:email)? — 초대 권한 (F-212)
  await page.route(/\/api\/(docs|folders)\/[^/]+\/grants(\/[^/]+)?$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    const url = new URL(req.url())
    const parts = url.pathname.split('/')
    const hasEmail = parts.at(-2) === 'grants'
    const email = hasEmail ? decodeURIComponent(parts.pop()) : null
    parts.pop() // 'grants'
    const targetId = decodeURIComponent(parts.pop())
    const targetType = parts.pop() === 'folders' ? 'folder' : 'doc'

    if (req.method() === 'GET' && !hasEmail) {
      const list = [...grants.entries()]
        .filter(([k]) => k.startsWith(`${targetType}:${targetId}:`))
        .map(([k, v]) => ({ email: k.split(':').slice(2).join(':'), role: v.role, createdAt: v.createdAt }))
        .sort((a, b) => a.createdAt - b.createdAt)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) })
    }
    if (req.method() === 'PUT' && hasEmail) {
      const body = req.postDataJSON()
      const key = `${targetType}:${targetId}:${email}`
      const createdAt = grants.get(key)?.createdAt ?? Date.now()
      grants.set(key, { role: body.role, createdAt })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email, role: body.role }) })
    }
    if (req.method() === 'DELETE' && hasEmail) {
      grants.delete(`${targetType}:${targetId}:${email}`)
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })

  // GET·PUT·DELETE /api/e2ee/keys — 금고 키 묶음 (F-401 3.1 판정, F-404 10.3)
  await page.route('**/api/e2ee/keys', async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    if (req.method() === 'GET') {
      if (!e2eeKeys) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no_vault"}' })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(e2eeKeys) })
    }
    if (req.method() === 'PUT') {
      if (recordWrite(route, req)) return
      const body = req.postDataJSON()
      const currentRev = e2eeKeys?.rev ?? 0
      if (body.baseRev !== currentRev) {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'conflict', rev: currentRev }) })
      }
      const rev = currentRev + 1
      e2eeKeys = { bundle: body.bundle, rev }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rev }) })
    }
    if (req.method() === 'DELETE') {
      if (recordWrite(route, req)) return
      // 금고 문서·폴더가 남았으면 지우지 않는다 (F-405 9.3, F-404 10.3 이 미룬 것)
      const vaultDocs = [...docs.values()].filter((d) => d.e2eeKey).length
      const vaultFolders = [...folders.values()].filter((f) => f.e2ee).length
      if (vaultDocs > 0 || vaultFolders > 0) {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'vault_not_empty', docs: vaultDocs, folders: vaultFolders }) })
      }
      e2eeKeys = null
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })

  // GET /api/shares — 공유 관리 페이지 목록 (F-243 3.1)
  await page.route('**/api/shares', async (route) => {
    if (offline) return route.abort('internetdisconnected')
    function targetName(targetType, targetId) {
      const rec = targetType === 'doc' ? docs.get(targetId) : folders.get(targetId)
      return rec ? (targetType === 'doc' ? rec.title : rec.name) : null
    }
    const links = [...shareLinks.entries()]
      .filter(([, v]) => !v.revokedAt)
      .map(([k, v]) => {
        const [targetType, targetId] = k.split(':')
        const name = targetName(targetType, targetId)
        return name === null ? null : { token: v.token, targetType, targetId, targetName: name, createdAt: v.createdAt }
      })
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt)
    const grantList = [...grants.entries()]
      .map(([k, v]) => {
        const [targetType, targetId, email] = k.split(':')
        const name = targetName(targetType, targetId)
        return name === null ? null : { targetType, targetId, targetName: name, email, role: v.role, createdAt: v.createdAt }
      })
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ links, grants: grantList }) })
  })

  // POST /api/docs/:id/comments/import — 로컬 댓글 이관 흉내 (F-508.md 3.5)
  const commentImports = new Map() // docId -> records
  const commentsExistIds = new Set()
  await page.route(/\/api\/docs\/[^/]+\/comments\/import$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    if (req.method() !== 'POST') return route.fallback()
    if (recordWrite(route, req)) return
    const id = decodeURIComponent(new URL(req.url()).pathname.split('/').slice(-3, -2)[0])
    if (!docs.has(id)) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
    if (commentsExistIds.has(id) || commentImports.has(id)) {
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'comments_exist' }) })
    }
    const body = req.postDataJSON()
    const records = Array.isArray(body.records) ? body.records : []
    commentImports.set(id, records)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ imported: records.length, orphaned: 0 }) })
  })

  // GET /api/docs/:id/comments/count — D-9 댓글 수 (F-509.md 3.3·6.3)
  const commentCounts = new Map() // docId -> number | { status, body }
  const commentCountLog = [] // 물은 문서 id, 순서대로
  await page.route(/\/api\/docs\/[^/]+\/comments\/count$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    if (req.method() !== 'GET') return route.fallback()
    const id = decodeURIComponent(new URL(req.url()).pathname.split('/').slice(-3, -2)[0])
    commentCountLog.push(id)
    const rule = commentCounts.get(id)
    if (rule && typeof rule === 'object') {
      return route.fulfill({ status: rule.status, contentType: 'application/json', body: JSON.stringify(rule.body ?? {}) })
    }
    if (!docs.has(id)) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
    if (docs.get(id).e2eeKey) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'e2ee_doc' }) })
    const n = typeof rule === 'number' ? rule : 0
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: n, open: n }) })
  })

  // F-2038 9.3 — 계정 삭제 미리 보기·삭제. accountDeleteRule 이 null 이면 204 + 로그아웃, 아니면 { status, body } 또는 'network'
  let accountPreview = {
    email,
    docs: 3,
    e2eeDocs: 0,
    sharedDocs: 1,
    folders: 1,
    attachments: { count: 2, bytes: 1_572_864 },
    tokens: 0,
    fresh: true,
    freshUntil: Date.now() + 600_000,
  }
  let accountDeleteRule = null
  const accountRequestCounts = { get: 0, delete: 0 }
  await page.route('**/api/account', (route) => {
    const req = route.request()
    if (offline) return route.abort('internetdisconnected')
    if (req.method() === 'GET') {
      accountRequestCounts.get += 1
      if (!loggedIn) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(accountPreview) })
    }
    if (req.method() === 'DELETE') {
      accountRequestCounts.delete += 1
      if (accountDeleteRule === 'network') return route.abort('failed')
      if (accountDeleteRule) {
        return route.fulfill({ status: accountDeleteRule.status, contentType: 'application/json', body: JSON.stringify(accountDeleteRule.body ?? {}) })
      }
      loggedIn = false
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })

  // F-507 3.8 — 알림함(/api/notifications*) + 멘션 후보(/api/docs/:id/people) 흉내
  let notificationItems = [] // NotificationItem[] — setNotifications 로 통째로 바꾼다
  let notificationsFailMode = null // null | 'network' | number — /api/notifications* 전용
  const notificationLog = [] // { method, path, search, body, at }[]
  const docPeopleOverrides = new Map() // docId -> { email, role }[] — 없으면 기본 규칙
  const peopleRequestLog = new Map() // docId -> count

  function logNotificationRequest(req) {
    const url = new URL(req.url())
    notificationLog.push({ method: req.method(), path: url.pathname, search: url.search, body: safePostDataJSON(req) ?? null, at: Date.now() })
  }

  await page.route('**/api/notifications', async (route) => {
    const req = route.request()
    if (req.method() !== 'GET') return route.fallback()
    logNotificationRequest(req)
    if (offline) return route.abort('internetdisconnected')
    if (notificationsFailMode === 'network') return route.abort('failed')
    if (typeof notificationsFailMode === 'number') {
      return route.fulfill({ status: notificationsFailMode, contentType: 'application/json', body: '{"error":"internal"}' })
    }
    const sorted = [...notificationItems].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    const items = sorted.slice(0, 30)
    const unread = notificationItems.filter((n) => n.readAt === null).length
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, unread }) })
  })

  await page.route('**/api/notifications/read', async (route) => {
    const req = route.request()
    if (req.method() !== 'POST') return route.fallback()
    logNotificationRequest(req)
    if (offline) return route.abort('internetdisconnected')
    if (notificationsFailMode === 'network') return route.abort('failed')
    if (typeof notificationsFailMode === 'number') {
      return route.fulfill({ status: notificationsFailMode, contentType: 'application/json', body: '{"error":"internal"}' })
    }
    if (recordWrite(route, req)) return
    const body = req.postDataJSON()
    const keys = body ? Object.keys(body) : []
    const isAll = keys.length === 1 && body.all === true
    const isIds = keys.length === 1 && Array.isArray(body.ids) && body.ids.length >= 1 && body.ids.length <= 50 && body.ids.every((id) => typeof id === 'string')
    if (!isAll && !isIds) {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid' }) })
    }
    const now = Date.now()
    if (isAll) {
      for (const item of notificationItems) if (item.readAt === null) item.readAt = now
    } else {
      const idSet = new Set(body.ids)
      for (const item of notificationItems) if (idSet.has(item.id) && item.readAt === null) item.readAt = now
    }
    return route.fulfill({ status: 204 })
  })

  await page.route(/\/api\/docs\/[^/]+\/people$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    if (req.method() !== 'GET') return route.fallback()
    const docId = decodeURIComponent(new URL(req.url()).pathname.split('/').slice(-2, -1)[0])
    peopleRequestLog.set(docId, (peopleRequestLog.get(docId) ?? 0) + 1)
    if (docPeopleOverrides.has(docId)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ people: docPeopleOverrides.get(docId) }) })
    }
    if (!docs.has(docId)) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
    const prefix = `doc:${docId}:`
    const granted = [...grants.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => ({ email: k.slice(prefix.length), role: v.role }))
      .sort((a, b) => a.email.localeCompare(b.email))
    const people = [{ email, role: 'owner' }, ...granted]
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ people }) })
  })

  // F-2042 8.1 — 이후 모든 /api/** 응답을 latencyMs 만큼 늦춘다. 마지막에 걸어 다른 경로보다 먼저 가로챈 뒤 route.fallback() 한다
  let latencyMs = 0
  const getRequestLog = [] // GET 요청만 기록 — 동시성 확인용 { path, startedAt, endedAt }
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const isGet = req.method() === 'GET'
    const path = new URL(req.url()).pathname
    const startedAt = Date.now()
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs))
    if (isGet) getRequestLog.push({ path, startedAt, endedAt: Date.now() })
    return route.fallback()
  })

  return {
    docs,
    folders,
    attachments,
    shareLinks,
    grants,
    apiTokens,
    // 네트워크 오프라인을 흉내낸다 — 이후 모든 요청은 실패한다 (F-207 A4)
    setOffline(v) {
      offline = v
    },
    // 다른 곳에서 먼저 바뀐 상황을 흉내낸다 (F-207 A5)
    bumpVersion(id) {
      const doc = docs.get(id)
      if (doc) {
        doc.version += 1
        doc.updatedAt = Date.now()
      }
    },
    // 계정당 이미지 사용량을 직접 설정한다 (F-221 A3·A4)
    setUsage(v) {
      usage = { ...usage, ...v }
    },
    // 로그아웃 응답을 바꾼다. null = 정상(200), 'network' = 연결 실패, 숫자 = 그 상태로 응답 (F-2034 7장)
    setSignOutFailure(mode) {
      signOutFailureMode = mode
    },
    // 지금까지 받은 POST /api/auth/sign-out 횟수 (F-2034 7장)
    signOutCount() {
      return signOutRequestCount
    },
    // /api/me 200 몸통에 합친다 — setMe({ blocked: true }) 처럼 (F-2030 3.6)
    setMe(patch) {
      mePatch = { ...mePatch, ...patch }
    },
    // 쓰기 경로(POST·PUT·DELETE)를 조종한다. null 로 해제 (F-2030 3.6)
    failWrites(rule) {
      writeRule = rule ? { ...rule } : null
    },
    // 쓰기 경로에 온 요청 기록 { method, path, at }[] — 실패시킨 것도 포함 (F-2030 3.6)
    writeRequests() {
      return [...writeLog]
    },
    // 금고 키 묶음을 직접 넣거나 뺀다 — { bundle, rev } | null (F-404 10.3)
    setE2eeKeys(value) {
      e2eeKeys = value
    },
    getE2eeKeys() {
      return e2eeKeys
    },
    // 폴더를 금고 폴더로 켜고 끈다 — 금고 폴더를 만드는 화면은 F-407 (F-405 9.3)
    // PUT /api/docs/:id/e2ee 응답의 purged 를 false 로 (F-407 9.3)
    setPurgeFails(on) {
      purgeFails = Boolean(on)
    },
    setFolderE2ee(folderId, on) {
      const folder = folders.get(folderId)
      if (!folder) return
      if (on) folder.e2ee = true
      else delete folder.e2ee
    },
    // 이후 모든 /api/** 응답을 ms 만큼 늦춘다. 0 이면 끈다 (F-2042 8.1)
    setLatency(ms) {
      latencyMs = ms
    },
    // 받은 GET 요청 기록 { path, startedAt, endedAt }[] — 동시성 확인용 (F-2042 8.1)
    readRequests() {
      return [...getRequestLog]
    },
    // GET /api/account 200 몸통에 합친다 (F-2038 9.3)
    setAccountPreview(patch) {
      accountPreview = { ...accountPreview, ...patch }
    },
    // DELETE /api/account 응답 — null = 204 + 로그아웃, { status, body } 또는 'network' (F-2038 9.3)
    setAccountDeleteRule(rule) {
      accountDeleteRule = rule
    },
    // 지금까지 받은 /api/account 요청 수 { get, delete } (F-2038 9.3)
    accountRequests() {
      return { ...accountRequestCounts }
    },
    // POST /api/docs/:id/comments/import 로 받은 기록 — docId -> records (F-508.md 3.5)
    commentImports,
    // 이관을 이미 받은 것으로 만들어 다음 요청이 409 comments_exist 가 되게 한다 (F-508.md 3.5)
    setCommentsExist(docId) {
      commentsExistIds.add(docId)
    },
    // 알림 목록을 통째로 바꾼다 — id 없으면 UUID 를 붙인다 (F-507 3.8)
    setNotifications(items) {
      notificationItems = items.map((item) => ({ id: item.id ?? crypto.randomUUID(), readAt: null, ...item }))
    },
    // 지금 목록 — 읽음 반영된 값의 사본 (F-507 3.8)
    notifications() {
      return notificationItems.map((item) => ({ ...item }))
    },
    // GET·POST 모두, 실패시킨 것 포함 (F-507 3.8)
    notificationRequests() {
      return notificationLog.map((r) => ({ ...r }))
    },
    // null | 'network' | number — /api/notifications* 에만 (F-507 3.8)
    failNotifications(mode) {
      notificationsFailMode = mode
    },
    // { email, role }[] | null — null 이면 기본 규칙으로 되돌린다 (F-507 3.8)
    setDocPeople(docId, people) {
      if (people === null) docPeopleOverrides.delete(docId)
      else docPeopleOverrides.set(docId, people)
    },
    // 그 문서로 받은 GET /people 수 (F-507 3.8)
    peopleRequests(docId) {
      return peopleRequestLog.get(docId) ?? 0
    },
    // GET /api/docs/:id/comments/count 응답을 조종한다 — 숫자(total·open 둘 다) | { status, body } (F-509.md 3.3)
    setCommentCount(docId, value) {
      commentCounts.set(docId, value)
    },
    // 지금까지 count 를 물은 문서 id, 순서대로 (F-509.md 3.3)
    commentCountRequests() {
      return [...commentCountLog]
    },
  }
}
