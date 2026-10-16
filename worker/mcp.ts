// POST /mcp — 원격 MCP 서버. 요청마다 서버를 새로 만들어 호출자를 닫아 넣는다 (F-3030 3장)
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import brand from '../brand.config'
import { TRASH_RETENTION_DAYS } from '../src/lib/trash'
import { errorResponse } from './http'
import { authenticateMcp } from './mcpAuth'
import type { McpCall } from './mcpCall'
import { registerReadTools } from './mcpReadTools'
import { registerTrashTools } from './mcpTrashTools'
import { registerWriteTools } from './mcpWriteTools'

export const MCP_INSTRUCTIONS = `${brand.name} stores Markdown documents exactly as written. Use search or list_documents to find a document, then fetch to read its full text. list_shared shows documents other people shared with you. Vault (end-to-end encrypted) documents are never available through this connection. To change a document, fetch it first and pass its version as baseVersion to update_document; on a conflict, reapply your edit to the returned document. Deleting moves documents to the trash, where the user can restore them in the app for ${TRASH_RETENTION_DAYS} days; deleting a folder also removes its subfolders and folder shares. Ask the user before deleting.`

export function createMcpServer(call: McpCall): McpServer {
  const server = new McpServer({ name: brand.cliName, title: brand.name, version: '1.0.0' }, { instructions: MCP_INSTRUCTIONS })
  registerReadTools(server, call)
  registerWriteTools(server, call)
  registerTrashTools(server, call)
  return server
}

export async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== 'POST') {
    const res = errorResponse('method_not_allowed', 405)
    res.headers.set('Allow', 'POST')
    return res
  }
  try {
    const caller = await authenticateMcp(request, env, ctx)
    if (caller instanceof Response) return caller
    const call: McpCall = { request, env, ctx, caller }
    return await createMcpHandler(() => createMcpServer(call), { legacy: 'stateless' }).fetch(request)
  } catch (err) {
    console.error(err)
    return errorResponse('internal', 500)
  }
}
