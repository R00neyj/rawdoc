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
  }): Promise<Doc>
  update(id: string, patch: { title?: string; content?: string }): Promise<Doc>
  remove(id: string): Promise<void>
  moveDoc(id: string, folderId: string | null): Promise<Doc>
  setPinned(id: string, pinned: boolean): Promise<Doc>
  listFolders(): Promise<Folder[]>
  createFolder(input: { name: string; parentId?: string | null }): Promise<Folder>
  renameFolder(id: string, name: string): Promise<Folder>
  moveFolder(id: string, parentId: string | null): Promise<Folder>
  removeFolder(id: string): Promise<void>
  putAttachment(input: {
    blob: Blob
    mime: string
    ext: AttachmentExt
    width: number
    height: number
  }): Promise<{ id: string; ext: AttachmentExt }>
  getAttachment(id: string): Promise<Attachment | null>
  listAttachments(): Promise<AttachmentMeta[]>
  removeAttachment(id: string): Promise<void>
  // idb 저장소에만 있다 (둘 다 있을 때만 OS 파일 열기 재중복 판정을 한다, F-231.md 3.3)
  findDocByFileHandle?(handle: FileSystemFileHandle): Promise<string | null>
  linkFileHandle?(docId: string, handle: FileSystemFileHandle): Promise<void>
}
