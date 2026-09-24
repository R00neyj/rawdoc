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

  await page.route(/\/api\/docs\/[^/]+\/folder$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    if (recordWrite(route, req)) return
    const id = decodeURIComponent(new URL(req.url()).pathname.split('/').slice(-2, -1)[0])
    const doc = docs.get(id)
    if (!doc) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
    const body = req.postDataJSON()
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
      const now = Date.now()
      const folder = { id: body.id || crypto.randomUUID(), name: body.name, parentId: body.parentId ?? null, createdAt: now, updatedAt: now }
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

  // PUT·GET /api/attachments/:id.:ext — 실제 서버 판정 없이 확장자를 그대로 믿는다(F-209 2.3·2.4 흉내)
  await page.route(/\/api\/attachments\/[0-9a-f]{16}\.(png|jpg|gif|webp)$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    const name = new URL(req.url()).pathname.split('/').pop()
    const m = /^([0-9a-f]{16})\.(png|jpg|gif|webp)$/.exec(name)
    const [, attId, ext] = m
    const key = `${attId}.${ext}`

    if (req.method() === 'PUT') {
      const existing = attachments.get(key)
      if (existing) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: attId, ext, mime: existing.mime, size: existing.bytes.length, width: existing.width, height: existing.height }),
        })
      }
      const bytes = req.postDataBuffer() ?? Buffer.alloc(0)
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
      return route.fulfill({ status: 200, contentType: record.mime, body: record.bytes })
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
  }
}
