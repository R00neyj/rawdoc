// MCP 읽기 도구 여섯 — /v1 핸들러를 직접 부르고, 목록의 금고 행은 빼고 센다 (F-3030 4장)
import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { getDocAccess, getOwnedFolder, type FolderRowLike } from './access'
import { findDocAttachment, parseIdExt, type AttachmentRow } from './attachments'
import { handleListFolders } from './folders'
import { MCP_LIST_PAGE, NOT_FOUND_MESSAGE, VAULT_DOC_MESSAGE, docUrl, innerV1, safeTool, titled, toToolResult, toolError, toolResult, type McpCall } from './mcpCall'
import { SEARCH_MAX_QUERY_CHARS } from './searchLines'
import { handleGetDocV1, handleListDocsV1, handleListSharedV1 } from './v1'
import type { V1Doc, V1DocSummary, V1Folder, V1SearchResult, V1SharedDoc } from './v1Contract'
import { handleSearchV1 } from './v1Search'

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
const IMAGE_PATH_RE = /^(?:attachments\/)?[0-9a-f]{16}\.(?:png|jpg|gif|webp)$/
const offsetSchema = z.number().int().min(0).optional()

// 정렬은 핸들러 그대로 두고 금고를 뺀 뒤에 자른다
function documentsPage<T extends { e2ee?: true }>(rows: T[], offset: number, toItem: (row: T) => Record<string, unknown>) {
  const visible = rows.filter((row) => row.e2ee !== true)
  const items = visible.slice(offset, offset + MCP_LIST_PAGE)
  const end = offset + items.length
  return {
    documents: items.map(toItem),
    vaultSkipped: rows.length - visible.length,
    ...(end < visible.length ? { nextOffset: end } : {}),
  }
}

export function registerReadTools(server: McpServer, call: McpCall): void {
  const { env, ctx } = call

  server.registerTool(
    'search',
    {
      ...titled('Search documents', READ_ONLY),
      description:
        'Find my own documents whose title or text contains the query (case-insensitive for English letters). Returns up to 200 matches, newest first.',
      inputSchema: z.object({ query: z.string().min(1).max(SEARCH_MAX_QUERY_CHARS) }),
    },
    safeTool(async ({ query }: { query: string }) => {
      const res = await handleSearchV1(innerV1(call, 'GET', `/v1/search?q=${encodeURIComponent(query)}`), env)
      if (!res.ok) return toToolResult(res)
      const body = (await res.json()) as V1SearchResult
      return toolResult({ results: body.docs.map((doc) => ({ id: doc.id, title: doc.title, url: docUrl(call, doc.id) })) })
    }),
  )

  server.registerTool(
    'fetch',
    {
      ...titled('Fetch document', READ_ONLY),
      description:
        'Read the full Markdown text of a document by id. Works for your documents and documents shared with you. The version is needed to update it.',
      inputSchema: z.object({ id: z.string().min(1).max(64) }),
    },
    safeTool(async ({ id }: { id: string }) => {
      const res = await handleGetDocV1(innerV1(call, 'GET', `/v1/docs/${encodeURIComponent(id)}`), env, ctx, { id })
      if (!res.ok) return toToolResult(res)
      const doc = (await res.json()) as V1Doc
      return toolResult({
        id: doc.id,
        title: doc.title,
        text: doc.content,
        url: docUrl(call, doc.id),
        metadata: { version: doc.version, folderId: doc.folderId, updatedAt: doc.updatedAt },
      })
    }),
  )

  server.registerTool(
    'fetch_image',
    {
      ...titled('Fetch image', READ_ONLY),
      description:
        'View an image attached to a document. Pass the document id and an attachments/… path from the text returned by fetch, such as attachments/0123456789abcdef.png.',
      inputSchema: z.object({ id: z.string().min(1).max(64), image: z.string().regex(IMAGE_PATH_RE) }),
    },
    safeTool(async ({ id, image }: { id: string; image: string }) => {
      const name = parseIdExt(image.replace(/^attachments\//, ''))
      if (!name) return toolError('Invalid argument: image.')
      const { user } = call.caller
      const access = await getDocAccess<{ id: string; owner_id: string; folder_id: string | null; content: string; e2ee_key?: string | null }>(
        env,
        id,
        user,
        'id, owner_id, folder_id, content',
      )
      if (!access) return toolError(NOT_FOUND_MESSAGE)
      if (access.doc.e2ee_key) return toolError(VAULT_DOC_MESSAGE)
      // 내 첨부는 /v1/attachments 처럼 참조 없이도 주되, 금고 첨부는 막는다
      const own = await env.DB.prepare('SELECT * FROM attachments WHERE owner_id = ? AND id = ? AND ext = ?')
        .bind(user.id, name.id, name.ext)
        .first<AttachmentRow>()
      if (own?.e2ee === 1) return toolError(VAULT_DOC_MESSAGE)
      const row = own ?? (await findDocAttachment(env, access.doc, name.id, name.ext))
      if (!row) return toolError(NOT_FOUND_MESSAGE)
      const object = await env.BUCKET.get(`att/${row.owner_id}/${name.id}.${name.ext}`)
      if (!object) return toolError(NOT_FOUND_MESSAGE)
      const bytes = new Uint8Array(await object.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return { content: [{ type: 'image', data: btoa(binary), mimeType: row.mime }] }
    }),
  )

  server.registerTool(
    'list_documents',
    {
      ...titled('List documents', READ_ONLY),
      description:
        'List your documents, newest first, 200 per page. Pass folderId for the documents directly in that folder, and nextOffset as offset for the next page.',
      inputSchema: z.object({ folderId: z.guid().optional(), offset: offsetSchema }),
    },
    safeTool(async ({ folderId, offset }: { folderId?: string; offset?: number }) => {
      if (folderId !== undefined && !(await getOwnedFolder<FolderRowLike>(env, folderId, call.caller.user))) return toolError(NOT_FOUND_MESSAGE)
      const res = await handleListDocsV1(innerV1(call, 'GET', '/v1/docs'), env)
      if (!res.ok) return toToolResult(res)
      const rows = (await res.json()) as V1DocSummary[]
      const scoped = folderId === undefined ? rows : rows.filter((doc) => doc.folderId === folderId)
      return toolResult(
        documentsPage(scoped, offset ?? 0, (doc) => ({
          id: doc.id,
          title: doc.title,
          folderId: doc.folderId,
          version: doc.version,
          updatedAt: doc.updatedAt,
          url: docUrl(call, doc.id),
        })),
      )
    }),
  )

  server.registerTool(
    'list_folders',
    {
      ...titled('List folders', READ_ONLY),
      description: 'List your folders as a tree (parentId null = top level).',
      inputSchema: z.object({}),
    },
    safeTool(async () => {
      const res = await handleListFolders(innerV1(call, 'GET', '/v1/folders'), env)
      if (!res.ok) return toToolResult(res)
      const rows = (await res.json()) as V1Folder[]
      const visible = rows.filter((folder) => folder.e2ee !== true)
      return toolResult({
        folders: visible.map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parentId })),
        vaultSkipped: rows.length - visible.length,
      })
    }),
  )

  server.registerTool(
    'list_shared',
    {
      ...titled('List shared documents', READ_ONLY),
      description: 'List documents other people shared with you, newest first, 200 per page.',
      inputSchema: z.object({ offset: offsetSchema }),
    },
    safeTool(async ({ offset }: { offset?: number }) => {
      const res = await handleListSharedV1(innerV1(call, 'GET', '/v1/shared'), env)
      if (!res.ok) return toToolResult(res)
      const rows = (await res.json()) as V1SharedDoc[]
      return toolResult(
        documentsPage(rows, offset ?? 0, (doc) => ({
          id: doc.id,
          title: doc.title,
          role: doc.role,
          ownerEmail: doc.ownerEmail,
          sharedFolder: doc.viaFolder?.name ?? null,
          updatedAt: doc.updatedAt,
          url: docUrl(call, doc.id),
        })),
      )
    }),
  )
}
