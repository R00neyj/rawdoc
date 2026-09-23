// 저장소 데이터 모양 (specs/architecture.md 2장)

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
}

// 폴더 삭제 방식 — 안의 문서·하위 폴더를 위로 옮기거나 전부 함께 지운다 (specs/features/F-242.md 3.1)
export type FolderDeleteMode = 'move-up' | 'delete-all'

export type Folder = {
  id: string
  name: string
  parentId: string | null
  createdAt: number
  updatedAt: number
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
  blob: Blob
}

export type AttachmentMeta = Pick<Attachment, 'id' | 'ext' | 'size' | 'createdAt'>

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
  }): Promise<Doc>
  update(id: string, patch: { title?: string; content?: string }): Promise<Doc>
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
  }): Promise<{ id: string; ext: AttachmentExt }>
  getAttachment(id: string): Promise<Attachment | null>
  listAttachments(): Promise<AttachmentMeta[]>
  removeAttachment(id: string): Promise<void>
  // idb 저장소에만 있다 (둘 다 있을 때만 OS 파일 열기 재중복 판정을 한다, F-231.md 3.3)
  findDocByFileHandle?(handle: FileSystemFileHandle): Promise<string | null>
  linkFileHandle?(docId: string, handle: FileSystemFileHandle): Promise<void>
}
