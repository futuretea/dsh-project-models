import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { appendFileSync } from 'node:fs'

export const name = 'project-models-command-driver'
export const inject = ['commands']

const LINES = (process.env.DRIVER_COMMANDS ?? '').split('\n').filter(line => line.length > 0)

/** Test-only: run scripted slash commands against the first top-level agent and log the results. */
export function apply(ctx: Context): void {
  let done = false
  ctx.on('agent/created', async ({ agent }: { agent: Agent }) => {
    if (done || agent.session.header.origin === 'subagent') return
    done = true
    for (const line of LINES) {
      const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
      appendFileSync(process.env.DRIVER_OUTPUT!, JSON.stringify({ line, result: execution?.result }) + '\n')
    }
  })
}
