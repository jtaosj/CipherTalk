import { getMcpConfigSnapshot, getMcpHealthPayload, getMcpStatusPayload } from './runtime'
import { McpReadService } from './readService'
import type { McpToolName } from './types'

const readService = new McpReadService()

export async function executeMcpTool(toolName: McpToolName, args: Record<string, unknown> = {}) {
  switch (toolName) {
    case 'health_check': {
      const payload = getMcpHealthPayload()
      return { summary: 'CipherTalk MCP health is available.', payload }
    }
    case 'get_status': {
      const payload = getMcpStatusPayload()
      return { summary: 'CipherTalk MCP status loaded.', payload }
    }
    case 'get_global_statistics': {
      const payload = await readService.getGlobalStatistics(args as any)
      return { summary: 'Loaded global statistics.', payload }
    }
    case 'get_contact_rankings': {
      const payload = await readService.getContactRankings(args as any)
      return { summary: `Loaded ${payload.items.length} contact rankings.`, payload }
    }
    case 'get_activity_distribution': {
      const payload = await readService.getActivityDistribution(args as any)
      return { summary: 'Loaded activity distribution.', payload }
    }
    case 'list_sessions': {
      const payload = await readService.listSessions(args as any)
      return { summary: `Loaded ${payload.items.length} sessions.`, payload }
    }
    case 'get_messages': {
      const defaults = getMcpConfigSnapshot()
      const payload = await readService.getMessages(args as any, defaults.mcpExposeMediaPaths)
      return { summary: `Loaded ${payload.items.length} messages.`, payload }
    }
    case 'list_contacts': {
      const payload = await readService.listContacts(args as any)
      return { summary: `Loaded ${payload.items.length} contacts.`, payload }
    }
    case 'search_messages': {
      const defaults = getMcpConfigSnapshot()
      const payload = await readService.searchMessages(args as any, defaults.mcpExposeMediaPaths)
      return { summary: `Loaded ${payload.hits.length} message hits.`, payload }
    }
    case 'get_session_context': {
      const defaults = getMcpConfigSnapshot()
      const payload = await readService.getSessionContext(args as any, defaults.mcpExposeMediaPaths)
      return { summary: `Loaded ${payload.items.length} context messages.`, payload }
    }
    default:
      throw new Error(`Unsupported MCP tool: ${toolName satisfies never}`)
  }
}
