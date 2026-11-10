import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { ProjectRule } from '../src/index.ts'
import { startMockModel, type SeenRequest } from './mock-model.ts'

const run = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dsh = join(root, 'node_modules', '.bin', 'dsh')
const TASK = 'PARENT-TASK: delegate the child task.'

let mock: Awaited<ReturnType<typeof startMockModel>>
let workdir: string

before(async () => {
  mock = await startMockModel()
  workdir = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-project-models-e2e-')))
})

after(() => {
  mock.server.close()
  rmSync(workdir, { recursive: true, force: true })
})

/** Profile rows: two mock providers, a deployment default, and optional plugin config. */
function profileRows(projects: ProjectRule[] | undefined, extraRows: object[]): object[] {
  const provider = (models: string[]) => ({
    apiKeyEnv: 'MOCK_MODEL_KEY',
    api: 'openai-completions',
    baseURL: mock.baseURL,
    models: models.map(id => ({ id })),
  })
  return [
    { id: 'llm-pi-ai', config: { providers: {
      'mock-main': provider(['default-model', 'main-model']),
      'mock-sub': provider(['sub-model', 'explicit-model']),
    } } },
    { id: 'agent-default-model', config: { provider: 'mock-main', model: 'default-model' } },
    ...projects === undefined ? [] : [{ id: 'project-models', config: { projects } }],
    ...extraRows,
  ]
}

/** Distinct models each role requested; provider retries of one request do not matter here. */
function modelsByRole(seen: readonly SeenRequest[]): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const { role, model } of seen) {
    const models = result[role] ??= []
    if (!models.includes(model)) models.push(model)
  }
  return result
}

interface Scenario {
  /** Rules written to the profile; `<project>` in a path is the scenario's project directory. */
  projects?: ProjectRule[]
  extraRows?: object[]
  env?: Record<string, string>
  overlay?: object[]
}

/**
 * Install the plugin into a fresh headless profile the way a user would, then
 * run one delegating task from inside the scenario's project directory.
 */
async function headless(name: string, scenario: Scenario): Promise<{ project: string; profilePatch: string; models: Record<string, string[]> }> {
  const project = join(workdir, name)
  mkdirSync(project, { recursive: true })
  const env = { ...process.env, DSH_HOME: join(workdir, `${name}-home`), MOCK_MODEL_KEY: 'mock-key', ...scenario.env }
  await run(dsh, ['plugin', '--profile', 'headless', 'add', root], { env })
  const profilePatch = join(env.DSH_HOME, 'profiles', 'headless', 'cordis.patch.yml')
  const projects = scenario.projects?.map(rule => ({ ...rule, path: rule.path.replace('<project>', project) }))
  writeFileSync(profilePatch, JSON.stringify(profileRows(projects, scenario.extraRows ?? []), null, 2))
  const args = ['headless']
  if (scenario.overlay !== undefined) {
    const overlay = join(workdir, `${name}.overlay.yml`)
    writeFileSync(overlay, JSON.stringify(scenario.overlay))
    args.push('--patch', overlay)
  }
  mock.seen.length = 0
  await run(dsh, [...args, TASK], { cwd: project, env, timeout: 90_000 })
  return { project, profilePatch, models: modelsByRole(mock.seen) }
}

const PROJECT_RULE: ProjectRule = {
  path: '<project>',
  main: { provider: 'mock-main', model: 'main-model' },
  sub: { provider: 'mock-sub', model: 'sub-model' },
}

test('a matching project routes the main agent and its subagent', async () => {
  const { models } = await headless('matched', { projects: [PROJECT_RULE] })
  assert.deepEqual(models, { parent: ['main-model'], child: ['sub-model'] })
})

test('a session outside every project keeps the deployment default', async () => {
  const { models } = await headless('unmatched', {
    projects: [{ ...PROJECT_RULE, path: join(tmpdir(), 'dsh-project-models-elsewhere') }],
  })
  assert.deepEqual(models, { parent: ['default-model'], child: ['default-model'] })
})

test('an explicit child route from the delegation tool wins over the project subagent model', async () => {
  const { models } = await headless('explicit', {
    projects: [PROJECT_RULE],
    extraRows: [{
      id: 'tool-subagent',
      config: { provider: 'spawn', toolName: 'subagent', agentOptions: { provider: 'mock-sub', model: 'explicit-model' } },
    }],
  })
  assert.deepEqual(models, { parent: ['main-model'], child: ['explicit-model'] })
})

test('/project-models edits persist to the profile and route the running session', async () => {
  const output = join(workdir, 'driver.jsonl')
  const { project, profilePatch, models } = await headless('commands', {
    overlay: [{ insert: [{ id: 'driver', name: join(root, 'test', 'command-driver.ts') }] }],
    env: {
      DRIVER_OUTPUT: output,
      DRIVER_COMMANDS: [
        '/project-models sub mock-sub/sub-model',
        '/project-models main nope/x',
        '/project-models main mock-main/main-model high',
        '/project-models main mock-main/main-model',
        '/project-models',
      ].join('\n'),
    },
  })
  const results = readFileSync(output, 'utf8').trim().split('\n')
    .map(line => (JSON.parse(line) as { result: { kind: string; text: string } }).result)
  assert.deepEqual(results.map(result => result.kind), ['success', 'error', 'error', 'success', 'success'])
  assert.match(results[1]!.text, /Unknown provider "nope"/)
  assert.match(results[2]!.text, /does not declare reasoning efforts/)
  assert.match(results[4]!.text, /Main agent: mock-main\/main-model\n/)
  assert.match(results[4]!.text, /Subagents: mock-sub\/sub-model/)

  assert.deepEqual(models, { parent: ['main-model'], child: ['sub-model'] })

  const persisted = readFileSync(profilePatch, 'utf8')
  assert.ok(persisted.includes(`path: ${project}`), persisted)
  assert.match(persisted, /model: sub-model/)
  assert.match(persisted, /model: main-model/)
})
