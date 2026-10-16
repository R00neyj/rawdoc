// MCP 쓰기 도구 넷 — 관문을 지난 뒤 /v1 핸들러를 직접 부른다 (F-3031 3장)
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { getOwnedFolder } from './access'
import { VAULT_DOC_MESSAGE, docUrl, innerV1, safeTool, toToolResult, toolError, toolResult, type McpCall } from './mcpCall'
import { BLOCKED_MESSAGE, gateMcpWrite } from './mcpWriteGate'
import { handleCreateDocV1, handleCreateFolderV1, handleMoveDocFolderV1, handleUpdateDocV1 } from './v1'
import type { V1Doc } from './v1Contract'

const CREATE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
const UPDATE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false }

const VAULT_FOLDER_MESSAGE = 'Vault (end-to-end encrypted) folders cannot be used through this connection.'
const FORBIDDEN_MESSAGE = 'You do not have permission to change this document.'
const FOLDER_NOT_FOUND_MESSAGE = 'Folder not found, or you do not have access. Use list_folders to find one.'

// 표에 있는 실패만 바꾸고 나머지는 null — 호출한 쪽이 toToolResult 로 넘긴다
async function writeFailure(res: Response, baseVersion?: number): Promise<CallToolResult | null> {
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { error?: unknown; doc?: { version?: number } } | null
  const error = body?.error
  if (res.status === 409 && error === 'conflict' && body?.doc && typeof baseVersion === 'number') {
    const doc = body.doc
    return toolError(
      `The document changed since version ${baseVersion} (now ${doc.version}). Nothing was written. The current document is in doc; apply your edit to it and retry with baseVersion ${doc.version}.`,
      { error: 'conflict', baseVersion, doc },
    )
  }
  if (res.status === 403 && error === 'e2ee_doc') return toolError(VAULT_DOC_MESSAGE, { error: 'e2ee_doc' })
  if ((res.status === 403 || res.status === 409) && error === 'e2ee_folder') return toolError(VAULT_FOLDER_MESSAGE, { error: 'e2ee_folder' })
  if (res.status === 403 && error === 'forbidden') return toolError(FORBIDDEN_MESSAGE, { error: 'forbidden' })
  if (res.status === 403 && error === 'account_blocked') return toolError(BLOCKED_MESSAGE, { error: 'account_blocked' })
  return null
}

async function failureResult(res: Response, baseVersion?: number): Promise<CallToolResult> {
  return (await writeFailure(res, baseVersion)) ?? toToolResult(res)
}

export function registerWriteTools(server: McpServer, call: McpCall): void {
  const { env, ctx } = call

  server.registerTool(
    'create_document',
    {
      title: 'Create document',
      description:
        'Create a new Markdown document. content is the full Markdown text. Omit folderId to create it at the top level (use list_folders for ids). Returns the new id, version and url.',
      inputSchema: z.object({ title: z.string(), content: z.string(), folderId: z.string().optional() }),
      annotations: CREATE,
    },
    safeTool(async ({ title, content, folderId }: { title: string; content: string; folderId?: string }) => {
      const gated = await gateMcpWrite(call)
      if (gated) return gated
      if (folderId !== undefined && !(await getOwnedFolder(env, folderId, call.caller.user))) {
        return toolError(FOLDER_NOT_FOUND_MESSAGE, { error: 'folder_not_found' })
      }
      const body: Record<string, unknown> = { title, content }
      if (folderId !== undefined) body.folderId = folderId
      const res = await handleCreateDocV1(innerV1(call, 'POST', '/v1/docs', body), env, ctx)
      if (!res.ok) return failureResult(res)
      const doc = (await res.json()) as V1Doc
      return toolResult({ id: doc.id, title: doc.title, version: doc.version, folderId: doc.folderId ?? null, updatedAt: doc.updatedAt, url: docUrl(call, doc.id) })
    }),
  )

  server.registerTool(
    'create_folder',
    {
      title: 'Create folder',
      description: 'Create a folder. Omit parentId for a top-level folder. Returns the new folder.',
      inputSchema: z.object({ name: z.string(), parentId: z.string().optional() }),
      annotations: CREATE,
    },
    safeTool(async ({ name, parentId }: { name: string; parentId?: string }) => {
      const gated = await gateMcpWrite(call)
      if (gated) return gated
      const body: Record<string, unknown> = { name }
      if (parentId !== undefined) body.parentId = parentId
      const res = await handleCreateFolderV1(innerV1(call, 'POST', '/v1/folders', body), env)
      return res.ok ? toToolResult(res) : failureResult(res)
    }),
  )

  server.registerTool(
    'move_document',
    {
      title: 'Move document',
      description: 'Move a document you own into a folder, or to the top level with folderId null. The text is not changed.',
      inputSchema: z.object({ id: z.string(), folderId: z.string().nullable() }),
      annotations: CREATE,
    },
    safeTool(async ({ id, folderId }: { id: string; folderId: string | null }) => {
      const gated = await gateMcpWrite(call)
      if (gated) return gated
      const res = await handleMoveDocFolderV1(innerV1(call, 'PUT', `/v1/docs/${encodeURIComponent(id)}/folder`, { folderId }), env, ctx, { id })
      return res.ok ? toToolResult(res) : failureResult(res)
    }),
  )

  server.registerTool(
    'update_document',
    {
      title: 'Update document',
      description:
        "Replace a document's whole text and/or its title. Read it with fetch first and pass its version as baseVersion. If the document changed since, nothing is written and the current document is returned so you can reapply your edit.",
      inputSchema: z.object({ id: z.string(), baseVersion: z.number().int(), content: z.string().optional(), title: z.string().optional() }),
      annotations: UPDATE,
    },
    safeTool(async ({ id, baseVersion, content, title }: { id: string; baseVersion: number; content?: string; title?: string }) => {
      const gated = await gateMcpWrite(call)
      if (gated) return gated
      if (content === undefined && title === undefined) return toolError('Provide content, title, or both.', { error: 'missing_change' })
      const body: Record<string, unknown> = { baseVersion }
      if (content !== undefined) body.content = content
      if (title !== undefined) body.title = title
      const res = await handleUpdateDocV1(innerV1(call, 'PUT', `/v1/docs/${encodeURIComponent(id)}`, body), env, ctx, { id })
      if (!res.ok) return failureResult(res, baseVersion)
      const doc = (await res.json()) as V1Doc
      return toolResult({ id: doc.id, title: doc.title, version: doc.version, updatedAt: doc.updatedAt, url: docUrl(call, doc.id) })
    }),
  )
}
