// 메모리 저장소 — 저장소를 못 쓸 때의 대체 (specs/architecture.md 2장)
// B1 은 IndexedDB 가 없으므로 이 저장소로만 동작한다 (F-110 이 idbStore 로 교체)

function clone(doc) {
  return { ...doc }
}

/** @returns {import('../../specs/architecture.md') 2장 인터페이스를 따르는 저장소 인스턴스} */
export function createMemoryStore() {
  const docs = new Map()

  return {
    kind: 'memory',

    async list() {
      return [...docs.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(clone)
    },

    async get(id) {
      const doc = docs.get(id)
      return doc ? clone(doc) : null
    },

    async create({ title, content, lineEnding }) {
      const now = Date.now()
      const doc = {
        id: crypto.randomUUID(),
        title,
        content,
        lineEnding,
        createdAt: now,
        updatedAt: now,
      }
      docs.set(doc.id, doc)
      return clone(doc)
    },

    async update(id, patch) {
      const existing = docs.get(id)
      if (!existing) {
        throw new Error(`문서를 찾을 수 없음: ${id}`)
      }
      const updated = {
        ...existing,
        ...('title' in patch ? { title: patch.title } : {}),
        ...('content' in patch ? { content: patch.content } : {}),
        updatedAt: Date.now(),
      }
      docs.set(id, updated)
      return clone(updated)
    },

    async remove(id) {
      docs.delete(id)
    },
  }
}
