// IndexedDB 를 열고 실패하면 메모리 저장소로 대체 (specs/features/F-110.md 3.2)
import { createIdbStore, type IdbStoreHandlers } from './idbStore'
import { createMemoryStore } from './memoryStore'
import type { Store } from '../types'

// handlers 는 createIdbStore 에 그대로 전달한다. indexedDB 가 없거나 열기 실패면 memoryStore 를 돌려준다 (F-136.md 3.3)
export async function openStore(handlers: IdbStoreHandlers = {}): Promise<Store> {
  if (typeof indexedDB === 'undefined') {
    return createMemoryStore()
  }
  try {
    return await createIdbStore(undefined, handlers)
  } catch {
    return createMemoryStore()
  }
}
