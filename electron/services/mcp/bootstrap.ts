import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createCipherTalkMcpServer } from './server'

let mcpServer: ReturnType<typeof createCipherTalkMcpServer> | null = null
let isShuttingDown = false

async function shutdown(code = 0) {
  if (isShuttingDown) return
  isShuttingDown = true

  try {
    await mcpServer?.close?.()
  } catch (error) {
    process.stderr.write(`[CipherTalk MCP] close error: ${String(error)}\n`)
  } finally {
    process.exit(code)
  }
}

function installProcessHandlers() {
  process.on('SIGINT', () => {
    void shutdown(0)
  })

  process.on('SIGTERM', () => {
    void shutdown(0)
  })

  process.on('uncaughtException', (error) => {
    process.stderr.write(`[CipherTalk MCP] uncaughtException: ${String(error)}\n`)
    void shutdown(1)
  })

  process.on('unhandledRejection', (error) => {
    process.stderr.write(`[CipherTalk MCP] unhandledRejection: ${String(error)}\n`)
    void shutdown(1)
  })
}

export async function bootstrapCipherTalkMcpServer() {
  installProcessHandlers()

  try {
    mcpServer = createCipherTalkMcpServer()
    const transport = new StdioServerTransport()
    await mcpServer.connect(transport)
    process.stderr.write('[CipherTalk MCP] stdio server started\n')
  } catch (error) {
    process.stderr.write(`[CipherTalk MCP] startup failed: ${String(error)}\n`)
    await shutdown(1)
  }
}
