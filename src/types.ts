// 저장소 데이터 모양 (specs/architecture.md 2장)
import type { CommentRecord } from './lib/docComments'

export type LineEnding = 'crlf' | 'lf'

export type Doc = {
  id: string
  title: string
  content: string
  lineEnding: LineEnding
  createdAt: number
  updatedAt: number
  folderId: string | null
  pinnedAt: number | null
  // 서버 저장소에서만 채운다 — 내 문서는 'owner', 공유받은 문서는 'edit'|'view' (specs/features/F-212.md 2.2·2.4)
  role?: 'owner' | 'edit' | 'view'
  // 공유받은 문서일 때만 — 소유자 이메일 (F-212.md 2.3)
  ownerEmail?: string
  // 공유받은 문서가 폴더 권한으로 보이는 것이면 그 폴더 (F-212.md 2.3·2.4)
  viaFolder?: { id: string; name: string } | null
  // 앱 층만 — withE2ee 가 채운다. 'locked' 면 title·content 가 빈 문자열 (F-405 3.1)
  e2ee?: 'locked' | 'open'
  // 저장소 층만 — 감싼 문서 키 base64. withE2ee 는 앱에 넘기기 전에 뺀다 (F-405 3.2)
  e2eeKey?: string
  // 금고 문서만 — 본문이 쓰는 첨부 id, 정렬·중복 없음 (F-405 4.3)
  attachmentRefs?: string[]
}

// 폴더 삭제 방식 — 안의 문서·하위 폴더를 위로 옮기거나 전부 함께 지운다 (specs/features/F-242.md 3.1)
export type FolderDeleteMode = 'move-up' | 'delete-all'

export type Folder = {
  id: string
  name: string
  parentId: string | null
  createdAt: number
  updatedAt: number
  // 금고 폴더 — 잠겨 있어도 이름은 평문 (F-405 3.1)
  e2ee?: true
}

export type AttachmentExt = 'png' | 'jpg' | 'gif' | 'webp'

export type Attachment = {
  id: string
  mime: string
  ext: AttachmentExt
  size: number
  width: number
  height: number
  createdAt: number
  // 저장소 층: blob 이 봉투(바이너리 그대로)다 / 앱 층(withE2ee 가 돌려준 것): 금고 첨부를 복호화한 평문이다 (F-406 2.1)
  e2ee?: true
  blob: Blob
}

export type AttachmentMeta = Pick<Attachment, 'id' | 'ext' | 'size' | 'createdAt'> & {
  // 서버 저장소만 채운다 — 아직 안 올린 첨부는 첨부 GC 에서 뺀다 (F-306 10장)
  uploaded?: boolean
}

// 서버 저장소 동기화 표시 (specs/features/F-207.md 2.5)
export type SyncState = { pending: number; online: boolean; signedOut: boolean }

export type Store = {
  kind: 'idb' | 'memory' | 'server'
  // server 저장소만 채운다. subscribeSync(listener) 는 즉시 1회 호출 후 변화마다 부르고, unsubscribe 함수를 돌려준다 (F-207.md 2.5)
  syncState?: SyncState
  subscribeSync?: (listener: (state: SyncState) => void) => () => void
  list(): Promise<Doc[]>
  get(id: string): Promise<Doc | null>
  create(input: {
    title: string
    content: string
    lineEnding: LineEnding
    folderId?: string | null
    // 가져오기(F-282)·이관이 원본 값을 유지할 때만 준다. id 가 이미 있으면 던진다(덮지 않는다) (F-282.md 3.11)
    id?: string
    createdAt?: number
    updatedAt?: number
    pinnedAt?: number | null
    // 앱 층 요청 — 폴더와 상관없이 금고 문서로 만든다. 아래 저장소는 무시한다 (F-405 3.1)
    e2ee?: true
    // 저장소 층 — withE2ee 가 채워 아래로 보낸다
    e2eeKey?: string
    attachmentRefs?: string[]
  }): Promise<Doc>
  // comments — 없으면 기록 행을 건드리지 않는다. [] 면 지운다. 1개 이상이면 통째로 바꾼다. 댓글만 바뀐 저장은 title·content·attachmentRefs 가 없으므로 updatedAt 을 올리지 않는다 (F-508 3.1·5.1)
  update(id: string, patch: { title?: string; content?: string; attachmentRefs?: string[]; comments?: CommentRecord[] }): Promise<Doc>
  remove(id: string): Promise<void>
  moveDoc(id: string, folderId: string | null): Promise<Doc>
  setPinned(id: string, pinned: boolean): Promise<Doc>
  listFolders(): Promise<Folder[]>
  createFolder(input: {
    name: string
    parentId?: string | null
    // 가져오기(F-282)가 id 를 유지할 때만 준다. 이미 있으면 던진다. createdAt·updatedAt 은 로컬 저장소에서만 쓰인다(서버는 안 받는다) (F-282.md 3.11)
    id?: string
    createdAt?: number
    updatedAt?: number
    e2ee?: true
  }): Promise<Folder>
  renameFolder(id: string, name: string): Promise<Folder>
  moveFolder(id: string, parentId: string | null): Promise<Folder>
  removeFolder(id: string, mode?: FolderDeleteMode): Promise<void>
  putAttachment(input: {
    blob: Blob
    mime: string
    ext: AttachmentExt
    width: number
    height: number
    // 주면 이 id 로 저장한다. 이미 있으면 덮지 않고 기존 것을 그대로 돌려준다. serverStore 는 WebP 변환을 건너뛴다 (F-282.md 3.11)
    id?: string
    // 앱 층: "이 이미지를 금고 첨부로 암호화해 넣어라" / 저장소 층: "blob 은 이미 봉투다" (F-406 2.1)
    e2ee?: true
  }): Promise<{ id: string; ext: AttachmentExt }>
  // 둘째 인자: 캐시·원문에서 확장자를 못 찾을 때 서버 저장소가 쓸 확장자. idb·메모리 저장소는 무시한다 (F-406 2.1)
  getAttachment(id: string, hint?: { ext: AttachmentExt }): Promise<Attachment | null>
  listAttachments(): Promise<AttachmentMeta[]>
  removeAttachment(id: string): Promise<void>
  // idb 저장소에만 있다 (둘 다 있을 때만 OS 파일 열기 재중복 판정을 한다, F-231.md 3.3)
  findDocByFileHandle?(handle: FileSystemFileHandle): Promise<string | null>
  linkFileHandle?(docId: string, handle: FileSystemFileHandle): Promise<void>
  // 금고로 옮기기·빼기 (F-407 3.1) — 앱 층은 평문만, 저장소 층은 옮기기면 봉투·e2eeKey·attachmentRefs, 빼기면 평문·둘 다 null
  setDocE2ee?(id: string, input: {
    e2ee: boolean
    title: string
    content: string
    e2eeKey?: string | null
    attachmentRefs?: string[] | null
  }): Promise<{ doc: Doc; purged: boolean }>
  // 폴더 표지 켜기·끄기. 서버 저장소는 곧바로 PUT /api/folders/:id (outbox 를 거치지 않는다)
  setFolderE2ee?(id: string, on: boolean): Promise<Folder>
  // 첨부 한 장을 곧바로 저장한다 — 바이트·확장자를 바꾸지 않는다(WebP 변환 없음). 앱 층 e2ee = 암호화해 넣어라, 저장소 층 e2ee = blob 은 이미 봉투
  putAttachmentNow?(input: {
    blob: Blob
    mime: string
    ext: AttachmentExt
    width: number
    height: number
    id?: string
    e2ee?: true
  }): Promise<{ id: string; ext: AttachmentExt }>
  // 첨부를 서버(와 기기 캐시)에서 지운다. 다른 문서가 쓰면 'in_use' 로 남긴다
  discardAttachment?(id: string, ext: AttachmentExt): Promise<'deleted' | 'not_found' | 'in_use'>
  // 로컬 문서 댓글 기록 — idb·memory 저장소만 채운다. 행이 있는데 검사를 통과 못 하면 던진다(Error('comments_row_invalid')) (F-508 3.1)
  getCommentRecords?(docId: string): Promise<CommentRecord[]>
  // 로그인 이관용 — 검사를 통과한 행만 docId → 기록 (F-508 3.1)
  listCommentRecords?(): Promise<Map<string, CommentRecord[]>>
}
