/**
 * Per-project main-agent and subagent model routes for DeepSeek Harness.
 * @module dsh-project-models
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-settings'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { Session } from '@deepseek-ai/dsh-session'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runCommand, type CommandDeps } from './command.ts'
import { Config, findRule, toSelection, type ProjectRule, type Route } from './config.ts'

export { Config }
export type { ProjectRule, Route } from './config.ts'

export const name = 'project-models'
export const inject = ['agents', 'sessions']

/** Working directory of the top-level Session that started this delegation tree. */
export function rootDir(ctx: Context, session: Session): string | undefined {
  let current = session
  for (;;) {
    const parentId = current.header.origin === 'subagent' ? current.header.parentSession : undefined
    const parent = parentId === undefined ? undefined : ctx.sessions.get(parentId)
    if (parent === undefined) return current.header.cwd
    current = parent
  }
}

/** Nearest ancestor holding `.git`, else `dir` itself. */
export function projectRoot(dir: string): string {
  for (let current = dir; ; current = dirname(current)) {
    if (existsSync(join(current, '.git'))) return current
    if (dirname(current) === current) return dir
  }
}

/** Reject unknown providers, models the adapter cannot resolve, and undeclared reasoning efforts. */
export async function validateRoute(ctx: Context, route: Route): Promise<string | undefined> {
  const llm = ctx.get('llm')
  if (llm === undefined) return undefined
  const providers = llm.listProviders().map(provider => provider.id)
  if (!providers.includes(route.provider)) {
    return `Unknown provider "${route.provider}". Registered providers: ${providers.join(', ') || 'none'}.`
  }
  let info
  try {
    info = await llm.resolveModelInfo(route.provider, route.model)
  } catch (error: unknown) {
    return `Model "${route.model}" is not available from "${route.provider}": ${error instanceof Error ? error.message : String(error)}`
  }
  if (route.reasoningEffort === undefined) return undefined
  const efforts = (info.reasoning?.efforts ?? []).map(effort => String(effort.id))
  if (efforts.includes(route.reasoningEffort)) return undefined
  return efforts.length === 0
    ? `${route.provider}/${route.model} does not declare reasoning efforts; omit the effort.`
    : `${route.provider}/${route.model} supports reasoning efforts: ${efforts.join(', ')}.`
}

function sameRoute(a: { provider: string; model: string }, b: { provider: string; model: string }): boolean {
  return a.provider === b.provider && a.model === b.model
}

/**
 * Select the project route for a freshly started agent. Resumed Sessions keep
 * their recorded choice. A subagent is only re-routed while it still carries
 * its parent's route, so an explicit child model from the delegation call or
 * the delegation tool's configuration wins.
 */
function routeNewAgent(ctx: Context, rules: readonly ProjectRule[], agent: Agent): void {
  const dir = rootDir(ctx, agent.session)
  const rule = dir === undefined ? undefined : findRule(rules, dir)
  if (rule === undefined) return
  const header = agent.session.header
  if (header.origin !== 'subagent') {
    if (rule.main !== undefined) agent.model.select(toSelection(rule.main))
    return
  }
  const route = rule.sub
  if (route === undefined) return
  const parent = header.parentSession === undefined ? undefined : ctx.agents.get(header.parentSession)
  const inherited = parent?.model.current()
  const own = agent.model.current()
  if (inherited !== undefined && own !== undefined && !sameRoute(inherited, own)) return
  agent.model.select(toSelection(route))
}

export function apply(ctx: Context, config: Config): void {
  const ownerFiber = ctx.fiber

  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ownerFiber))
  })

  ctx.on('agent/created', ({ agent, source }) => {
    if (source !== 'startup') return
    routeNewAgent(ctx, config.projects.get() as readonly ProjectRule[], agent)
  })

  const deps: CommandDeps = {
    rules: () => config.projects.get() as readonly ProjectRule[],
    async save(next) {
      const entry = ownerFiber.entry
      const editor = ctx.get('configEditor')
      if (entry === undefined || editor === undefined) {
        throw new Error('this deployment cannot persist plugin configuration; edit the profile cordis.patch.yml instead')
      }
      const projects = JSON.parse(JSON.stringify(next)) as ProjectRule[]
      await editor.edit(entry, current => ({ ...current, projects }))
    },
    validate: route => validateRoute(ctx, route),
    rootDir: agent => rootDir(ctx, agent.session),
    projectRoot,
  }

  ctx.inject(['commands'], (child) => {
    child.commands.register({
      definitionId: CommandDefinitionId('dsh-project-models'),
      name: 'project-models',
      description: 'Show or set the main-agent and subagent models for this project',
      input: { hint: '[main|sub <provider>/<model> [effort] | remember | unset main|sub | forget]' },
      handler: invocation => runCommand(deps, invocation.agent, invocation.rawInput),
    })
  })
}
