import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { runCommand, parseCommand, type CommandDeps } from '../src/command.ts'
import { findRule, normalizeDir, parseRoute, type ProjectRule } from '../src/config.ts'
import { routeNewAgent } from '../src/index.ts'

const rule = (path: string, extra: Partial<ProjectRule> = {}): ProjectRule => ({ path, ...extra })

test('findRule picks the most specific containing project and respects path boundaries', () => {
  const rules = [rule('/work'), rule('/work/a'), rule('/work/ab')]
  assert.equal(findRule(rules, '/work/a/src')?.path, '/work/a')
  assert.equal(findRule(rules, '/work/ab')?.path, '/work/ab')
  assert.equal(findRule(rules, '/work/abc')?.path, '/work')
  assert.equal(findRule(rules, '/elsewhere'), undefined)
})

test('normalizeDir expands ~ and drops trailing separators', () => {
  assert.equal(normalizeDir('~/proj/'), `${homedir()}/proj`)
  assert.equal(findRule([rule('~/proj')], `${homedir()}/proj/x`)?.path, '~/proj')
})

test('a rule written through a symlink matches the real session directory', () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-project-models-unit-'))
  try {
    mkdirSync(join(base, 'real', 'src'), { recursive: true })
    symlinkSync(join(base, 'real'), join(base, 'link'))
    const linked = rule(join(base, 'link'))
    assert.equal(findRule([linked], join(base, 'real', 'src')), linked)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('parseRoute keeps slashes inside model ids and accepts an optional effort', () => {
  assert.deepEqual(parseRoute(['openrouter/moonshotai/kimi-k3', 'high']), {
    provider: 'openrouter', model: 'moonshotai/kimi-k3', reasoningEffort: 'high',
  })
  assert.match(parseRoute(['kimi']) as string, /expected <provider>\/<model>/)
  assert.match(parseRoute(['a/b', 'high', 'extra']) as string, /unexpected arguments/)
})

test('parseCommand covers the grammar and rejects malformed input', () => {
  assert.equal(parseCommand('  '), 'show')
  assert.deepEqual(parseCommand('sub zai/glm-5.3 high'), {
    kind: 'set', slot: 'sub', route: { provider: 'zai', model: 'glm-5.3', reasoningEffort: 'high' },
  })
  assert.deepEqual(parseCommand('unset sub'), { kind: 'unset', slot: 'sub' })
  assert.match(parseCommand('unset preset review') as string, /expected: unset/)
  assert.match(parseCommand('preset review a/b') as string, /unknown subcommand/)
  assert.match(parseCommand('frobnicate') as string, /unknown subcommand/)
})

function fakeAgent(current: ModelSelection | undefined, origin?: 'subagent'): Agent & { selected: ModelSelection[] } {
  const selected: ModelSelection[] = []
  return {
    selected,
    session: { header: { cwd: '/work/a', ...origin === undefined ? {} : { origin, parentSession: 'parent' } } },
    model: { current: () => current, select: (selection: ModelSelection) => { selected.push(selection) } },
  } as unknown as Agent & { selected: ModelSelection[] }
}

function fakeDeps(rules: ProjectRule[]): CommandDeps & { saved: ProjectRule[][] } {
  const saved: ProjectRule[][] = []
  return {
    saved,
    rules: () => rules,
    save: async (next) => { saved.push(next) },
    validate: async () => undefined,
    rootDir: agent => agent.session.header.cwd,
    projectRoot: dir => dir,
  }
}

test('remember saves the session model as the project main route without reselecting it', async () => {
  const deps = fakeDeps([])
  const agent = fakeAgent({ provider: 'moonshotai', model: 'kimi-k3' })
  const result = await runCommand(deps, agent, 'remember')
  assert.equal(result.kind, 'success')
  assert.deepEqual(deps.saved, [[{ path: '/work/a', main: { provider: 'moonshotai', model: 'kimi-k3' } }]])
  assert.deepEqual(agent.selected, [])
})

test('main applies to the current top-level session but not to a subagent session', async () => {
  const top = fakeAgent(undefined)
  await runCommand(fakeDeps([]), top, 'main openai/gpt-astra')
  assert.deepEqual(top.selected, [{ provider: 'openai', model: 'gpt-astra' }])
  const child = fakeAgent(undefined, 'subagent')
  await runCommand(fakeDeps([]), child, 'main openai/gpt-astra')
  assert.deepEqual(child.selected, [])
})

test('edits target the matched rule; unset and forget remove settings', async () => {
  const existing = rule('/work', { main: { provider: 'a', model: 'm' }, sub: { provider: 'b', model: 's' } })
  const deps = fakeDeps([rule('/other'), existing])
  await runCommand(deps, fakeAgent(undefined), 'unset sub')
  assert.deepEqual(deps.saved.at(-1), [rule('/other'), rule('/work', { main: { provider: 'a', model: 'm' } })])
  await runCommand(deps, fakeAgent(undefined), 'forget')
  assert.deepEqual(deps.saved.at(-1), [rule('/other')])
})

test('a subagent carrying its parent\'s exact route is re-routed; an explicit effort is not', () => {
  const rules = [rule('/work', { sub: { provider: 'sub-p', model: 'sub-m' } })]
  const parentSelection: ModelSelection = {
    provider: 'main-p', model: 'main-m', reasoningEffort: ReasoningEffortId('low'),
  }
  const parent = fakeAgent(parentSelection)
  const ctx = {
    sessions: { get: () => undefined },
    agents: { get: () => parent },
  } as unknown as Context
  const inherited = fakeAgent(parentSelection, 'subagent')
  routeNewAgent(ctx, rules, inherited)
  assert.deepEqual(inherited.selected, [{ provider: 'sub-p', model: 'sub-m' }])
  const explicit = fakeAgent({ ...parentSelection, reasoningEffort: ReasoningEffortId('high') }, 'subagent')
  routeNewAgent(ctx, rules, explicit)
  assert.deepEqual(explicit.selected, [])
})

test('a failed validation or save is reported and nothing is selected', async () => {
  const deps = { ...fakeDeps([]), validate: async () => 'Unknown provider "x".' }
  const agent = fakeAgent(undefined)
  assert.deepEqual(await runCommand(deps, agent, 'main x/y'), { kind: 'error', text: 'Unknown provider "x".' })
  const failing = { ...fakeDeps([]), save: async () => { throw new Error('read-only') } }
  const result = await runCommand(failing, agent, 'main a/b')
  assert.equal(result.kind, 'error')
  assert.match(result.text ?? '', /read-only/)
  assert.deepEqual(agent.selected, [])
})
