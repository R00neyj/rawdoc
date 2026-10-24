// MCP 지우기 도구 둘 — 문서·폴더를 휴지통으로 보낸다 (F-3032)
import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { TRASH_RETENTION_DAYS, trashActorForMcp } from '../src/lib/trash/trash'
import { VAULT_DOC_MESSAGE, safeTool, titled, toolError, toolResult, type McpCall } from './mcpCall'
import { gateMcpWrite } from './mcpWriteGate'
import { trashDoc, trashFolder } from './trash'

const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
const E2EE_FOLDER_MESSAGE = 'Folders that contain vault (end-to-end encrypted) items cannot be deleted through this connection.'

export function registerTrashTools(server: McpServer, call: McpCall): void {
  const { env, ctx, caller } = call
  const options = { by: trashActorForMcp(caller.clientName), allowE2ee: false }

  server.registerTool(
    'delete_document',
    {
      ...titled('Move document to trash', DESTRUCTIVE),
      description: `Moves one of your documents to the trash. It disappears from lists, search and shared links at once, and is permanently deleted after ${TRASH_RETENTION_DAYS} days unless the user restores it from the trash in the app. Only the owner can do this. Vault (end-to-end encrypted) documents cannot be deleted through this connection.`,
      inputSchema: z.object({ id: z.string().describe('Document id from search, fetch or list_documents.') }),
    },
    safeTool(async ({ id }: { id: string }) => {
      const gated = await gateMcpWrite(call)
      if (gated) return gated
      const res = await trashDoc(env, ctx, caller.user, id, options)
      if (res.ok) return toolResult({ id: res.id, title: res.title, trashed: true, retentionDays: TRASH_RETENTION_DAYS })
      if (res.error === 'forbidden') return toolError('Only the owner can move this document to the trash.', { error: 'forbidden' })
      if (res.error === 'e2ee_doc') return toolError(VAULT_DOC_MESSAGE, { error: 'e2ee_doc' })
      return toolError(`No document with id ${id}.`, { error: 'not_found' })
    }),
  )

  server.registerTool(
    'delete_folder',
    {
      ...titled('Delete folder', DESTRUCTIVE),
      description: `Deletes one of your folders together with its subfolders and moves every document inside to the trash. Documents can be restored from the trash in the app for ${TRASH_RETENTION_DAYS} days; a restored document goes back to the top level if its folder no longer exists. Shares and links on the folder are removed and do not come back. Fails without changing anything if any vault (end-to-end encrypted) item is inside.`,
      inputSchema: z.object({ id: z.string().describe('Folder id from list_folders.') }),
    },
    safeTool(async ({ id }: { id: string }) => {
      const gated = await gateMcpWrite(call)
      if (gated) return gated
      const res = await trashFolder(env, ctx, caller.user, id, options)
      if (res.ok) {
        return toolResult({ id: res.id, parentId: res.parentId, trashedDocuments: res.docs, deletedFolders: res.folders, retentionDays: TRASH_RETENTION_DAYS })
      }
      if (res.error === 'e2ee_folder') return toolError(E2EE_FOLDER_MESSAGE, { error: 'e2ee_folder' })
      return toolError(`No folder with id ${id}.`, { error: 'not_found' })
    }),
  )
}
