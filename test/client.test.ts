import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ProjectModelsController, routeKey, toDraft, toStored, validate,
  type ProjectModelsSettings, type StoredRule,
} from '../src/client/controller.ts'

const catalog = {
  ok: true,
  value: {
    groups: [{
      id: 'openai',
      name: 'OpenAI',
      models: [
        { id: 'gpt-astra', name: 'GPT Astra', reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } },
        { id: 'gpt-sol', name: 'GPT Sol' },
      ],
    }],
  },
}

function fakeScope(projects: StoredRule[], options: { writable?: boolean; accept?: boolean } = {}) {
  let snapshot = { status: 'ready' as const, value: { projects } as ProjectModelsSettings, base: undefined, user: undefined, writable: options.writable ?? true, revision: 1 }
  const listeners = new Set<() => void>()
  const writes: unknown[] = []
  return {
    writes,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate: async (ops: readonly { op: string; path: readonly string[]; value?: unknown }[]) => {
      writes.push(ops)
      if (options.accept === false) return false
      snapshot = { ...snapshot, value: { projects: ops[0]!.value as StoredRule[] }, revision: snapshot.revision + 1 }
      for (const listener of listeners) listener()
      return true
    },
    /** Simulate an edit landing from elsewhere. */
    replace(next: StoredRule[]) {
      snapshot = { ...snapshot, value: { projects: next }, revision: snapshot.revision + 1 }
      for (const listener of listeners) listener()
    },
  }
}

async function settle(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
}

test('stored rules round-trip through the draft unchanged', () => {
  const rules: StoredRule[] = [{
    path: '~/a',
    main: { provider: 'openai', model: 'gpt-astra', reasoningEffort: 'high' },
    sub: { provider: 'openai', model: 'gpt-sol' },
  }]
  assert.deepEqual(toStored(toDraft(rules)), rules)
})

test('validate flags empty, relative, and duplicate paths', () => {
  const problems = validate(toDraft([{ path: '/a' }, { path: '/a' }, { path: 'rel' }, { path: '' }, { path: '~/b' }]))
  assert.deepEqual(problems, { r0: 'duplicate', r1: 'duplicate', r2: 'relative', r3: 'empty' })
})

test('editing and saving writes the complete project list in one revision-fenced mutation', async () => {
  const scope = fakeScope([])
  const controller = new ProjectModelsController(scope, async () => catalog)
  await settle()
  const face = controller.inject()
  const state = () => face.hooks.projectModelsPage.getSnapshot()
  assert.equal(state().catalogStatus, 'ready')

  face.addProject()
  const rule = state().rules[0]!.key
  face.setPath(rule, '/work/a')
  face.setRoute(rule, 'main', routeKey({ provider: 'openai', model: 'gpt-astra' }))
  face.setEffort(rule, 'main', 'high')
  face.setRoute(rule, 'sub', routeKey({ provider: 'openai', model: 'gpt-sol' }))
  assert.equal(state().dirty, true)
  assert.equal(state().invalid, false)

  face.save()
  await settle()
  assert.deepEqual(scope.writes, [[{ op: 'set', path: ['projects'], value: [{
    path: '/work/a',
    main: { provider: 'openai', model: 'gpt-astra', reasoningEffort: 'high' },
    sub: { provider: 'openai', model: 'gpt-sol' },
  }] }]])
  assert.equal(state().dirty, false)
  assert.equal(state().failed, false)
  controller.dispose()
})

test('an invalid draft cannot be saved and a refused save is reported', async () => {
  const scope = fakeScope([], { accept: false })
  const controller = new ProjectModelsController(scope, async () => catalog)
  const face = controller.inject()
  const state = () => face.hooks.projectModelsPage.getSnapshot()
  face.addProject()
  face.save()
  await settle()
  assert.equal(scope.writes.length, 0)
  face.setPath(state().rules[0]!.key, '/x')
  face.save()
  await settle()
  assert.equal(scope.writes.length, 1)
  assert.equal(state().failed, true)
  controller.dispose()
})

test('a change from elsewhere while drafting blocks the save until the draft is discarded', async () => {
  const scope = fakeScope([{ path: '/a' }])
  const controller = new ProjectModelsController(scope, async () => catalog)
  const face = controller.inject()
  const state = () => face.hooks.projectModelsPage.getSnapshot()
  face.setPath('r0', '/b')
  scope.replace([{ path: '/c' }])
  assert.equal(state().conflicted, true)
  face.save()
  await settle()
  assert.equal(scope.writes.length, 0)
  face.discard()
  assert.equal(state().conflicted, false)
  assert.equal(state().rules[0]!.path, '/c')
  controller.dispose()
})

test('a read-only deployment ignores edits', () => {
  const scope = fakeScope([], { writable: false })
  const controller = new ProjectModelsController(scope, async () => catalog)
  const face = controller.inject()
  face.addProject()
  assert.equal(face.hooks.projectModelsPage.getSnapshot().rules.length, 0)
  controller.dispose()
})
