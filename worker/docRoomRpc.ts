// 다른 핸들러가 DocRoom 에 알리는 도우미 — 원래 응답은 알림 성공과 무관하게 나간다 (specs/features/F-304.md 9.3)
import type { RoomCommentImport, RoomCommentImportResult, RoomTextWrite, RoomTextWriteResult } from './docRoomCore'

type RoomStub = {
  revalidateConnections(email?: string): Promise<void>
  purgeRoom(): Promise<void>
  writeText(input: RoomTextWrite): Promise<RoomTextWriteResult>
  importComments(input: RoomCommentImport): Promise<RoomCommentImportResult>
}

function roomStub(env: Env, docId: string): RoomStub | null {
  const ns = (env as unknown as { DOC_ROOM?: { getByName(name: string): unknown } }).DOC_ROOM
  if (!ns) return null
  return ns.getByName(docId) as RoomStub
}

async function dispatch(ctx: ExecutionContext | undefined, call: () => Promise<void>): Promise<void> {
  const task = (async () => {
    try {
      await call()
    } catch (err) {
      console.error('docRoom notify failed', err)
    }
  })()
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task)
  else await task
}

export async function notifyRevalidate(
  env: Env,
  ctx: ExecutionContext | undefined,
  docId: string,
  email: string,
): Promise<void> {
  const stub = roomStub(env, docId)
  if (!stub) return
  await dispatch(ctx, () => stub.revalidateConnections(email))
}

export async function notifyPurge(env: Env, ctx: ExecutionContext | undefined, docId: string): Promise<void> {
  const stub = roomStub(env, docId)
  if (!stub) return
  await dispatch(ctx, () => stub.purgeRoom())
}

// /v1 PUT (F-308 5.4) — 결과가 응답을 바꾸므로 기다린다. 던지면 null — Worker 가 D1 직접 쓰기로 넘긴다(9장)
export async function writeTextInRoom(env: Env, docId: string, input: RoomTextWrite): Promise<RoomTextWriteResult | null> {
  const stub = roomStub(env, docId)
  if (!stub) return null
  try {
    return await stub.writeText(input)
  } catch (err) {
    console.error('docRoom writeText failed', err)
    return null
  }
}

// 로그인 이관 (F-503 5장) — 던지면 null. API 는 503 으로 답하고 outbox 가 다시 보낸다
export async function importCommentsInRoom(env: Env, docId: string, input: RoomCommentImport): Promise<RoomCommentImportResult | null> {
  const stub = roomStub(env, docId)
  if (!stub) return null
  try {
    return await stub.importComments(input)
  } catch (err) {
    console.error('docRoom importComments failed', err)
    return null
  }
}
