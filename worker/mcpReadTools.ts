// MCP 읽기 도구 다섯 — /v1 핸들러를 직접 부르고, 목록의 금고 행은 빼고 센다 (F-3030 4장)
import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { getOwnedFolder, type FolderRowLike } from './access'
import { handleListFolders } from './folders'
import { MCP_LIST_PAGE, NOT_FOUND_MESSAGE, docUrl, innerV1, safeTool, toToolResult, toolError, toolResult, type McpCall } from './mcpCall'
import { SEARCH_MAX_QUERY_CHARS } from './searchLines'
import { handleGetDocV1, handleListDocsV1, handleListSharedV1 } from './v1'
import type { V1Doc, V1DocSummary, V1Folder, V1SearchResult, V1SharedDoc } from './v1Contract'
import { handleSearchV1 } from './v1Search'

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
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
      title: 'Search documents',
      description:
        'Find my own documents whose title or text contains the query (case-insensitive for English letters). Returns up to 200 matches, newest first.',
      inputSchema: z.object({ query: z.string().min(1).max(SEARCH_MAX_QUERY_CHARS) }),
      annotations: READ_ONLY,
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
      title: 'Fetch document',
      description:
        'Read the full Markdown text of a document by id. Works for your documents and documents shared with you. The version is needed to update it.',
      inputSchema: z.object({ id: z.string().min(1).max(64) }),
      annotations: READ_ONLY,
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
    'list_documents',
    {
      title: 'List documents',
      description:
        'List your documents, newest first, 200 per page. Pass folderId for the documents directly in that folder, and nextOffset as offset for the next page.',
      inputSchema: z.object({ folderId: z.guid().optional(), offset: offsetSchema }),
      annotations: READ_ONLY,
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
      title: 'List folders',
      description: 'List your folders as a tree (parentId null = top level).',
      inputSchema: z.object({}),
      annotations: READ_ONLY,
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
      title: 'List shared documents',
      description: 'List documents other people shared with you, newest first, 200 per page.',
      inputSchema: z.object({ offset: offsetSchema }),
      annotations: READ_ONLY,
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
