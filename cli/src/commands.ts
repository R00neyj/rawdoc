// 명령마다 결과 데이터를 돌려주는 함수. 출력하지 않는다. 입력은 이미 해석된 값이다 — 파일 읽기는 main 쪽 층에서 끝낸다 (specs/features/F-2021.md 4.7)
import type { V1Attachment, V1Doc, V1DocSummary, V1Folder, V1Link, V1Me } from '../../worker/v1Contract'
import {
  apiCreateDoc,
  apiCreateFolder,
  apiCreateLink,
  apiGetDoc,
  apiListDocs,
  apiListFolders,
  apiMe,
  apiUpdateDoc,
  apiUploadAttachment,
  type ClientConfig,
} from './client'

export function whoami(cfg: ClientConfig): Promise<V1Me> {
  return apiMe(cfg)
}

// ls --folder 는 받은 목록을 folderId 가 같은 것만 남긴다 — 서버에 거르기 인자가 없다 (4.2)
export async function ls(cfg: ClientConfig, folder: string | null): Promise<V1DocSummary[]> {
  const docs = await apiListDocs(cfg)
  return folder === null ? docs : docs.filter((d) => d.folderId === folder)
}

export function get(cfg: ClientConfig, id: string): Promise<V1Doc> {
  return apiGetDoc(cfg, id)
}

export type NewInput = { title: string; content: string; lineEnding: 'crlf' | 'lf'; folderId: string | null }

export function createDoc(cfg: ClientConfig, input: NewInput): Promise<V1Doc> {
  const body: { title: string; content: string; lineEnding: 'crlf' | 'lf'; folderId?: string } = {
    title: input.title,
    content: input.content,
    lineEnding: input.lineEnding,
  }
  if (input.folderId !== null) body.folderId = input.folderId
  return apiCreateDoc(cfg, body)
}

export type PutInput = { id: string; content?: string; title?: string; baseVersion: number | null; force: boolean }

// --force 는 GET 뒤 그 version 으로 PUT(요청 2회). --base-version 은 PUT 1회 (4.2)
export async function putDoc(cfg: ClientConfig, input: PutInput): Promise<V1Doc> {
  let baseVersion = input.baseVersion
  if (input.force) {
    const current = await apiGetDoc(cfg, input.id)
    baseVersion = current.version
  }
  const body: { title?: string; content?: string; baseVersion: number } = { baseVersion: baseVersion as number }
  if (input.title !== undefined && input.title !== null) body.title = input.title
  if (input.content !== undefined && input.content !== null) body.content = input.content
  return apiUpdateDoc(cfg, input.id, body)
}

export function folders(cfg: ClientConfig): Promise<V1Folder[]> {
  return apiListFolders(cfg)
}

export function mkdir(cfg: ClientConfig, name: string, parentId: string | null): Promise<V1Folder> {
  const body: { name: string; parentId?: string } = { name }
  if (parentId !== null) body.parentId = parentId
  return apiCreateFolder(cfg, body)
}

export function upload(cfg: ClientConfig, bytes: Uint8Array): Promise<V1Attachment> {
  return apiUploadAttachment(cfg, bytes)
}

export function link(cfg: ClientConfig, id: string): Promise<V1Link> {
  return apiCreateLink(cfg, id)
}
