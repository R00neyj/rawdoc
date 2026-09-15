// F-206 API 를 page.route 로 메모리에서 흉내낸다 (specs/features/F-207.md 1장 파일 소유)
import crypto from 'node:crypto'

// 로그인 상태로 /api/me·/api/docs·/api/folders 를 흉내낸다
export async function fakeServer(page, { id = 'u1', email = 'a@b.com' } = {}) {
  const docs = new Map()
  const folders = new Map()
  // context.setOffline() 은 page.route 가 먼저 가로채 못 걸러낸다 — 이 플래그로 직접 흉내낸다 (F-207 A4)
  let offline = false

  function docSummary(d) {
    const { content: _content, ...rest } = d
    return rest
  }

  await page.route('**/api/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, email }) }),
  )

  await page.route('**/api/docs', async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    if (req.method() === 'GET') {
      const list = [...docs.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(docSummary)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) })
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON()
      if (body.id && docs.has(body.id)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(docs.get(body.id)) })
      }
      const now = Date.now()
      const doc = {
        id: body.id || crypto.randomUUID(),
        title: body.title,
        content: body.content,
        lineEnding: body.lineEnding,
        folderId: body.folderId ?? null,
        pinnedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
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
      docs.delete(id)
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })

  await page.route(/\/api\/docs\/[^/]+\/folder$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
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
      if (!folder) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
      const body = req.postDataJSON()
      if (body.name !== undefined) folder.name = body.name
      if (body.parentId !== undefined) folder.parentId = body.parentId
      folder.updatedAt = Date.now()
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(folder) })
    }
    if (req.method() === 'DELETE') {
      folders.delete(id)
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })

  return {
    docs,
    folders,
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
  }
}
