import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** One request seen by the mock: who sent it and which model it asked for. */
export interface SeenRequest {
  role: 'parent' | 'child'
  model: string
}

interface ChatMessage {
  role: string
  content?: unknown
}

const CHILD_TASK = 'CHILD-TASK: reply with done.'

function text(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(part => (part as { text?: unknown }).text).filter(t => typeof t === 'string').join('')
  }
  return ''
}

function sse(chunks: readonly object[]): string {
  return chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
}

function chunk(model: string, delta: object, finish: string | null): object {
  return { id: 'mock', object: 'chat.completion.chunk', created: 0, model, choices: [{ index: 0, delta, finish_reason: finish }] }
}

/**
 * OpenAI Chat Completions mock that scripts one delegation: the parent calls
 * the `subagent` tool once, the child answers, then the parent finishes.
 */
export async function startMockModel(): Promise<{ server: Server; baseURL: string; seen: SeenRequest[] }> {
  const seen: SeenRequest[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (data: Buffer) => { body += data.toString() })
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404).end()
        return
      }
      const request = JSON.parse(body) as { model: string; messages: ChatMessage[] }
      const isChild = request.messages.some(message => message.role === 'user' && text(message.content).includes(CHILD_TASK))
      const hasToolResult = request.messages.some(message => message.role === 'tool')
      seen.push({ role: isChild ? 'child' : 'parent', model: request.model })
      let chunks: object[]
      if (isChild) {
        chunks = [chunk(request.model, { role: 'assistant', content: 'done' }, null), chunk(request.model, {}, 'stop')]
      } else if (!hasToolResult) {
        const args = JSON.stringify({ description: 'mock child task', prompt: CHILD_TASK })
        chunks = [
          chunk(request.model, {
            role: 'assistant',
            tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'subagent', arguments: args } }],
          }, null),
          chunk(request.model, {}, 'tool_calls'),
        ]
      } else {
        chunks = [chunk(request.model, { role: 'assistant', content: 'parent done' }, null), chunk(request.model, {}, 'stop')]
      }
      const delayMs = !isChild && hasToolResult ? 1500 : 0
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(sse(chunks))
      }, delayMs)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, baseURL: `http://127.0.0.1:${port}/v1`, seen }
}
