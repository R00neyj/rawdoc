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

export type Store = {
  kind: 'idb' | 'memory'
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
}
