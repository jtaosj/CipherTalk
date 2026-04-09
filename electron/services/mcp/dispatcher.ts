import { buildToolResultText } from './presentation'
import { getMcpConfigSnapshot, getMcpHealthPayload, getMcpStatusPayload } from './runtime'
import { McpReadService } from './readService'
import type { McpStreamPartialPayloadMap, McpStreamProgressPayload, McpToolName } from './types'

const readService = new McpReadService()

type ExecuteStreamReporter = {
  progress?: (payload: McpStreamProgressPayload) => void | Promise<void>
  partial?: <K extends keyof McpStreamPartialPayloadMap>(toolName: K, payload: McpStreamPartialPayloadMap[K]) => void | Promise<void>
}

export async function executeMcpTool(
  toolName: McpToolName,
  args: Record<string, unknown> = {},
  reporter?: ExecuteStreamReporter
) {
  switch (toolName) {
    case 'health_check': {
      const payload = getMcpHealthPayload()
      return { summary: 'CipherTalk MCP health is available.', payload }
    }
    case 'get_status': {
      const payload = getMcpStatusPayload()
      return { summary: 'CipherTalk MCP status loaded.', payload }
    }
    case 'get_moments_timeline': {
      const payload = await readService.getMomentsTimeline(args as any)
      return { summary: buildToolResultText('get_moments_timeline', payload), payload }
    }
    case 'resolve_session': {
      const payload = await readService.resolveSession(args as any, reporter)
      return { summary: buildToolResultText('resolve_session', payload), payload }
    }
    case 'export_chat': {
      const payload = await readService.exportChat(args as any, reporter)
      return {
        summary: payload.success
          ? `Exported chat for ${payload.resolvedSession?.displayName || payload.resolvedSession?.sessionId || 'target session'}.`
          : payload.success === false
            ? `Failed to export chat for ${payload.resolvedSession?.displayName || payload.resolvedSession?.sessionId || 'target session'}.`
            : payload.canExport
            ? `Prepared export for ${payload.resolvedSession?.displayName || payload.resolvedSession?.sessionId || 'target session'}.`
            : 'Export request needs more information.',
        payload
      }
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
      const payload = await readService.listSessions(args as any, reporter)
      return { summary: buildToolResultText('list_sessions', payload), payload }
    }
    case 'get_messages': {
      const defaults = getMcpConfigSnapshot()
      const payload = await readService.getMessages(args as any, defaults.mcpExposeMediaPaths, reporter)
      return { summary: buildToolResultText('get_messages', payload), payload }
    }
    case 'list_contacts': {
      const payload = await readService.listContacts(args as any, reporter)
      return { summary: buildToolResultText('list_contacts', payload), payload }
    }
    case 'search_messages': {
      const defaults = getMcpConfigSnapshot()
      const payload = await readService.searchMessages(args as any, defaults.mcpExposeMediaPaths, reporter)
      return { summary: buildToolResultText('search_messages', payload), payload }
    }
    case 'get_session_context': {
      const defaults = getMcpConfigSnapshot()
      const payload = await readService.getSessionContext(args as any, defaults.mcpExposeMediaPaths, reporter)
      return { summary: buildToolResultText('get_session_context', payload), payload }
    }
    default:
      throw new Error(`Unsupported MCP tool: ${toolName satisfies never}`)
  }
}
