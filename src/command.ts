import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import {
  findRule, formatRoute, normalizeDir, parseRoute, toSelection,
  type ProjectRule, type Route,
} from './config.ts'

export const USAGE = [
  'Usage:',
  '  /project-models                                  show this project\'s models',
  '  /project-models main <provider>/<model> [effort]  set the main agent model',
  '  /project-models sub <provider>/<model> [effort]   set the subagent model',
  '  /project-models remember                          save this session\'s current model as main',
  '  /project-models unset main|sub                   remove one setting',
  '  /project-models forget                            remove this project\'s settings',
].join('\n')

/** Host facts the command reads and the only write it performs. */
export interface CommandDeps {
  rules(): readonly ProjectRule[]
  /** Persist the complete rule list; rejects when the deployment cannot persist configuration. */
  save(next: ProjectRule[]): Promise<void>
  /** Check a route against the LLM registry; returns a user-facing problem, or undefined when usable. */
  validate(route: Route): Promise<string | undefined>
  /** Root Session working directory used for project matching. */
  rootDir(agent: Agent): string | undefined
  /** Project directory recorded for a new rule created from `dir`. */
  projectRoot(dir: string): string
}

type Edit =
  | { kind: 'set'; slot: 'main' | 'sub'; route: Route }
  | { kind: 'remember' }
  | { kind: 'unset'; slot: 'main' | 'sub' }
  | { kind: 'forget' }

/** Parse one invocation; `show` for empty input, a string for syntax errors. */
export function parseCommand(rawInput: string): Edit | 'show' | string {
  const [verb, ...args] = rawInput.trim().split(/\s+/u).filter(token => token.length > 0)
  if (verb === undefined) return 'show'
  switch (verb.toLowerCase()) {
    case 'main':
    case 'sub': {
      const route = parseRoute(args)
      return typeof route === 'string' ? route : { kind: 'set', slot: verb.toLowerCase() as 'main' | 'sub', route }
    }
    case 'remember':
      return args.length === 0 ? { kind: 'remember' } : `unexpected arguments: ${args.join(' ')}`
    case 'forget':
      return args.length === 0 ? { kind: 'forget' } : `unexpected arguments: ${args.join(' ')}`
    case 'unset': {
      const [slot, ...extra] = args
      if ((slot === 'main' || slot === 'sub') && extra.length === 0) return { kind: 'unset', slot }
      return 'expected: unset main | unset sub'
    }
    default:
      return `unknown subcommand "${verb}"`
  }
}

/** Render the matched rule and the session's current route. */
export function describe(dir: string | undefined, rule: ProjectRule | undefined, agent: Agent): string {
  const lines = [
    `Directory: ${dir ?? 'unknown'}`,
    `Project rule: ${rule === undefined ? 'none' : normalizeDir(rule.path)}`,
    `Main agent: ${rule?.main === undefined ? 'not set (deployment default)' : formatRoute(rule.main)}`,
    `Subagents: ${rule?.sub === undefined ? 'not set (delegation default)' : formatRoute(rule.sub)}`,
  ]
  lines.push(`This session now: ${formatRoute(agent.model.current())}`)
  return lines.join('\n')
}

/** Produce the next rule for `edit`; undefined removes the rule. */
function applyEdit(rule: ProjectRule, edit: Edit, current: Route | undefined): ProjectRule | undefined {
  switch (edit.kind) {
    case 'set': return { ...rule, [edit.slot]: edit.route }
    case 'remember': return { ...rule, main: current }
    case 'unset': {
      const next = { ...rule }
      delete next[edit.slot]
      return next
    }
    case 'forget': return undefined
  }
}

function routeOf(selection: ReturnType<Agent['model']['current']>): Route | undefined {
  if (selection === undefined) return undefined
  return {
    provider: selection.provider,
    model: selection.model,
    ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: String(selection.reasoningEffort) },
  }
}

function newRoute(edit: Edit): Route | undefined {
  return edit.kind === 'set' ? edit.route : undefined
}

/**
 * Execute `/project-models` for the agent whose UI received it.
 * @returns direct UI output; nothing reaches the model.
 */
export async function runCommand(deps: CommandDeps, agent: Agent, rawInput: string): Promise<CommandResult> {
  const parsed = parseCommand(rawInput)
  const dir = deps.rootDir(agent)
  const rules = deps.rules()
  const rule = dir === undefined ? undefined : findRule(rules, dir)
  if (parsed === 'show') return { kind: 'success', text: `${describe(dir, rule, agent)}\n\n${USAGE}` }
  if (typeof parsed === 'string') return { kind: 'error', text: `${parsed}\n\n${USAGE}` }
  if (dir === undefined) return { kind: 'error', text: 'This session has no working directory, so no project can be matched.' }

  const route = newRoute(parsed)
  const problem = route === undefined ? undefined : await deps.validate(route)
  if (problem !== undefined) return { kind: 'error', text: problem }
  const current = routeOf(agent.model.current())
  if (parsed.kind === 'remember' && current === undefined) {
    return { kind: 'error', text: 'This session has no model selected yet.' }
  }
  if (rule === undefined && parsed.kind !== 'set' && parsed.kind !== 'remember') {
    return { kind: 'success', text: 'This project has no settings.' }
  }

  const base: ProjectRule = rule ?? { path: deps.projectRoot(dir) }
  const nextRule = applyEdit(base, parsed, current)
  const next = rules.filter(candidate => candidate !== rule)
  if (nextRule !== undefined) next.push(nextRule)
  try {
    await deps.save(next)
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    return { kind: 'error', text: `Could not save project models: ${reason}` }
  }

  const isTopLevel = agent.session.header.origin !== 'subagent'
  if (parsed.kind === 'set' && parsed.slot === 'main' && isTopLevel) agent.model.select(toSelection(parsed.route))
  const applied = parsed.kind === 'set' && parsed.slot === 'main' && isTopLevel
    ? 'Applied to this session from its next step; new sessions in this project use it too.'
    : 'New sessions and subagents in this project use the change.'
  return { kind: 'success', text: `${describe(dir, nextRule, agent)}\n\n${applied}` }
}
