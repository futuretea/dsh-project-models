import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, sep } from 'node:path'

/** One provider/model route with an optional adapter-owned reasoning effort. */
export interface Route {
  provider: string
  model: string
  reasoningEffort?: string
}

/** Model routes for every Session whose root working directory is inside `path`. */
export interface ProjectRule {
  /** Absolute project directory; a leading `~` expands to the home directory. */
  path: string
  /** Route for top-level agents. Omitted keeps the deployment default. */
  main?: Route
  /** Route for subagents. Omitted keeps the delegation backend's choice. */
  sub?: Route
}

export interface Config {
  projects: Volatile<ProjectRule[]>
}

const RouteSchema = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
})

const OptionalRoute = z.union([RouteSchema, z.const(undefined)])

export const Config = z.object({
  projects: z.array(z.object({
    path: z.string().required(),
    main: OptionalRoute,
    sub: OptionalRoute,
  })).default([]).volatile(),
})

/**
 * Normalize a configured or observed directory for prefix comparison.
 * Existing paths resolve symlinks, so `/tmp/x` and `/private/tmp/x` match on macOS.
 * @param dir - absolute path, optionally starting with `~`.
 * @returns the resolved path without a trailing separator.
 */
export function normalizeDir(dir: string): string {
  const expanded = dir === '~' || dir.startsWith(`~${sep}`) || dir.startsWith('~/')
    ? homedir() + dir.slice(1)
    : dir
  const absolute = resolve(expanded)
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

/**
 * Pick the most specific rule containing `dir`.
 * @param rules - configured project rules.
 * @param dir - absolute directory to classify.
 * @returns the rule with the longest matching path, if any.
 */
export function findRule(rules: readonly ProjectRule[], dir: string): ProjectRule | undefined {
  const target = normalizeDir(dir)
  let best: { rule: ProjectRule; length: number } | undefined
  for (const rule of rules) {
    const root = normalizeDir(rule.path)
    const inside = target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)
    if (inside && (best === undefined || root.length > best.length)) best = { rule, length: root.length }
  }
  return best?.rule
}

/** Convert a configured route into the Agent-facing selection type. */
export function toSelection(route: Route): ModelSelection {
  return {
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) },
  }
}

/** Human-readable `provider/model (effort)` label. */
export function formatRoute(route: Readonly<Route> | Readonly<ModelSelection> | undefined): string {
  if (route === undefined) return 'not set'
  const effort = route.reasoningEffort === undefined ? '' : ` (${String(route.reasoningEffort)})`
  return `${route.provider}/${route.model}${effort}`
}

/**
 * Parse `provider/model [effort]` tokens. The model id keeps any further slashes.
 * @param tokens - whitespace-separated command arguments.
 * @returns the route, or an error message.
 */
export function parseRoute(tokens: readonly string[]): Route | string {
  const [spec, effort, ...extra] = tokens
  if (spec === undefined) return 'missing <provider>/<model>'
  if (extra.length > 0) return `unexpected arguments: ${extra.join(' ')}`
  const slash = spec.indexOf('/')
  if (slash <= 0 || slash === spec.length - 1) return `expected <provider>/<model>, got "${spec}"`
  return {
    provider: spec.slice(0, slash),
    model: spec.slice(slash + 1),
    ...effort === undefined ? {} : { reasoningEffort: effort },
  }
}
