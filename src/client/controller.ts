/** Staged editor for the `project-models` entry's project rules. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormScope, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'

/** Host entry id whose `projects` field the page edits. */
export const PROJECT_MODELS_NS = 'project-models'

/** One stored provider/model route. */
export interface StoredRoute {
  provider: string
  model: string
  reasoningEffort?: string
}

/** One stored project rule, as the Host plugin's schema resolves it. */
export interface StoredRule {
  path: string
  main?: StoredRoute
  sub?: StoredRoute
}

/** Settings section served for the entry. */
export interface ProjectModelsSettings {
  projects: StoredRule[]
}

/** One project row in the draft. */
export interface DraftRule {
  key: string
  path: string
  main: StoredRoute | undefined
  sub: StoredRoute | undefined
}

/** One model offered by the Host catalog. */
export interface CatalogModel {
  provider: string
  providerName: string
  model: string
  modelName: string
  efforts: string[]
}

/** A directory problem that blocks a save. */
export type PathProblem = 'empty' | 'relative' | 'duplicate'

/** State rendered by the page. */
export interface ProjectModelsPageState extends SettingsFormShell {
  rules: readonly DraftRule[]
  /** Directory problems keyed by rule. */
  problems: Readonly<Record<string, PathProblem>>
  catalog: readonly CatalogModel[]
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  conflicted: boolean
}

/** Which route of a rule an edit targets. */
export type RouteSlot = 'main' | 'sub'

/** Registration-side face for the page. */
export interface ProjectModelsPageFace {
  hooks: {
    /** Bound by the renderer as useProjectModelsPage. */
    projectModelsPage: SnapshotStore<ProjectModelsPageState>
  }
  addProject: () => void
  removeProject: (rule: string) => void
  setPath: (rule: string, path: string) => void
  /** Select a catalog route by its key, or clear the slot with the empty string. */
  setRoute: (rule: string, slot: RouteSlot, routeKey: string) => void
  /** Select an effort, or follow the model default with the empty string. */
  setEffort: (rule: string, slot: RouteSlot, effort: string) => void
  retryCatalog: () => void
  save: () => void
  discard: () => void
}

/** Minimal Host catalog shape the page reads. */
export interface CatalogResponse {
  ok: boolean
  value?: {
    groups: readonly {
      id: string
      name: string
      models: readonly { id: string; name: string; reasoning?: { efforts: readonly { id: string }[] } }[]
    }[]
  }
}

/** Stable lookup key for one route; never parsed. */
export function routeKey(route: { provider: string; model: string }): string {
  return `${route.provider}\0${route.model}`
}

/** Flatten the Host catalog into selectable models. */
export function catalogModels(response: CatalogResponse): CatalogModel[] {
  return (response.value?.groups ?? []).flatMap(group => group.models.map(model => ({
    provider: group.id,
    providerName: group.name,
    model: model.id,
    modelName: model.name,
    efforts: (model.reasoning?.efforts ?? []).map(effort => String(effort.id)),
  })))
}

function cloneRoute(route: StoredRoute | undefined): StoredRoute | undefined {
  if (route === undefined) return undefined
  return {
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort },
  }
}

/** Convert stored rules into keyed draft rows. */
export function toDraft(rules: readonly StoredRule[]): DraftRule[] {
  return rules.map((rule, index) => ({
    key: `r${index}`,
    path: rule.path,
    main: cloneRoute(rule.main),
    sub: cloneRoute(rule.sub),
  }))
}

/** Convert draft rows into the stored shape the Host schema accepts. */
export function toStored(rules: readonly DraftRule[]): StoredRule[] {
  return rules.map(rule => ({
    path: rule.path.trim(),
    ...rule.main === undefined ? {} : { main: cloneRoute(rule.main) },
    ...rule.sub === undefined ? {} : { sub: cloneRoute(rule.sub) },
  }))
}

/** Directory problems per rule; an empty object means the draft can be saved. */
export function validate(rules: readonly DraftRule[]): Record<string, PathProblem> {
  const problems: Record<string, PathProblem> = {}
  const seen = new Map<string, number>()
  for (const rule of rules) {
    const path = rule.path.trim()
    seen.set(path, (seen.get(path) ?? 0) + 1)
  }
  for (const rule of rules) {
    const path = rule.path.trim()
    if (path.length === 0) problems[rule.key] = 'empty'
    else if (!path.startsWith('/') && path !== '~' && !path.startsWith('~/')) problems[rule.key] = 'relative'
    else if ((seen.get(path) ?? 0) > 1) problems[rule.key] = 'duplicate'
  }
  return problems
}

function sameStored(left: readonly StoredRule[], right: readonly StoredRule[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Bridges the entry's configuration form and the Host model catalog onto one staged page. */
export class ProjectModelsController {
  private draft: DraftRule[] | undefined
  private draftRevision: number | undefined
  private nextKey = 0
  private saving = false
  private failed = false
  private conflicted = false
  private disposed = false
  private saveGeneration = 0
  private catalogGeneration = 0
  private catalog: CatalogModel[] = []
  private catalogStatus: ProjectModelsPageState['catalogStatus'] = 'idle'
  private readonly store: SnapshotStore<ProjectModelsPageState>
  private readonly unsubscribe: () => void
  private readonly scope: SettingsFormScope<ProjectModelsSettings>
  private readonly loadCatalog: () => Promise<CatalogResponse>

  /**
   * @param scope - bound `project-models` configuration form.
   * @param loadCatalog - reads the Host model catalog.
   */
  constructor(scope: SettingsFormScope<ProjectModelsSettings>, loadCatalog: () => Promise<CatalogResponse>) {
    this.scope = scope
    this.loadCatalog = loadCatalog
    this.store = createSnapshotStore(this.projection())
    this.unsubscribe = scope.subscribe(() => {
      if (!this.saving && this.draft !== undefined && this.scope.getSnapshot().revision !== this.draftRevision) {
        if (sameStored(this.current(), toStored(this.draft))) this.clearDraft()
        else this.conflicted = true
      }
      this.publish()
    })
    void this.refreshCatalog()
  }

  /** Stop observing settings and ignore late catalog or write settlements. */
  dispose(): void {
    this.disposed = true
    this.saveGeneration += 1
    this.catalogGeneration += 1
    this.unsubscribe()
  }

  /** @returns the face injected into the page registration. */
  inject(): ProjectModelsPageFace {
    return {
      hooks: { projectModelsPage: this.store },
      addProject: () => { this.edit(rules => { rules.push(this.emptyRule()) }) },
      removeProject: (rule) => { this.edit(rules => rules.filter(candidate => candidate.key !== rule)) },
      setPath: (rule, path) => { this.editRule(rule, (target) => { target.path = path }) },
      setRoute: (rule, slot, key) => { this.editRule(rule, (target) => { this.writeRoute(target, slot, key) }) },
      setEffort: (rule, slot, effort) => {
        this.editRule(rule, (target) => {
          const route = target[slot]
          if (route === undefined) return
          if (effort === '') delete route.reasoningEffort
          else route.reasoningEffort = effort
        })
      },
      retryCatalog: () => { void this.refreshCatalog() },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  /** Reload the catalog after the Host's model inputs change. */
  async refreshCatalog(): Promise<void> {
    if (this.disposed) return
    const generation = ++this.catalogGeneration
    this.catalogStatus = 'loading'
    this.publish()
    let response: CatalogResponse
    try {
      response = await this.loadCatalog()
    } catch {
      response = { ok: false }
    }
    if (generation !== this.catalogGeneration) return
    if (response.ok) {
      this.catalog = catalogModels(response)
      this.catalogStatus = 'ready'
    } else {
      this.catalogStatus = 'error'
    }
    this.publish()
  }

  /** Drop the draft after a reconnect: it was staged against another Host generation. */
  resetConnection(): void {
    if (this.disposed) return
    this.saveGeneration += 1
    this.saving = false
    this.clearDraft()
    void this.refreshCatalog()
  }

  private current(): StoredRule[] {
    return toStored(toDraft(this.scope.getSnapshot().value?.projects ?? []))
  }

  private rules(): DraftRule[] {
    return this.draft ?? toDraft(this.scope.getSnapshot().value?.projects ?? [])
  }

  private emptyRule(): DraftRule {
    return { key: `n${this.nextKey++}`, path: '', main: undefined, sub: undefined }
  }

  private edit(change: (rules: DraftRule[]) => DraftRule[] | void): void {
    const snapshot = this.scope.getSnapshot()
    if (this.disposed || snapshot.status !== 'ready' || !snapshot.writable || this.saving) return
    if (this.draft === undefined) {
      this.draft = toDraft(snapshot.value?.projects ?? [])
      this.draftRevision = snapshot.revision
    }
    const next = change(this.draft)
    if (next !== undefined) this.draft = next
    this.failed = false
    this.publish()
  }

  private editRule(key: string, change: (rule: DraftRule) => void): void {
    this.edit((rules) => {
      const rule = rules.find(candidate => candidate.key === key)
      if (rule !== undefined) change(rule)
    })
  }

  private writeRoute(rule: DraftRule, slot: RouteSlot, key: string): void {
    const previous = rule[slot]
    const choice = this.catalog.find(model => routeKey(model) === key)
      ?? (previous !== undefined && routeKey(previous) === key ? previous : undefined)
    const route = key === '' || choice === undefined
      ? undefined
      : {
        provider: choice.provider,
        model: choice.model,
        ...previous !== undefined && routeKey(previous) === key && previous.reasoningEffort !== undefined
          ? { reasoningEffort: previous.reasoningEffort }
          : {},
      }
    rule[slot] = route
  }

  private clearDraft(): void {
    this.draft = undefined
    this.draftRevision = undefined
    this.failed = false
    this.conflicted = false
  }

  private discard(): void {
    if (this.saving) return
    this.clearDraft()
    this.publish()
  }

  private async save(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    const state = this.projection()
    if (this.disposed || this.draft === undefined || !state.writable || !state.dirty || state.invalid || this.saving) return
    if (snapshot.revision !== this.draftRevision) {
      this.conflicted = true
      this.publish()
      return
    }
    const desired = toStored(this.draft)
    const generation = this.saveGeneration
    this.saving = true
    this.failed = false
    this.publish()
    let accepted = false
    try {
      accepted = await this.scope.mutate([{ op: 'set', path: ['projects'], value: desired }], this.draftRevision)
    } catch {
      accepted = false
    }
    if (generation !== this.saveGeneration) return
    this.saving = false
    const landed = accepted && sameStored(this.current(), desired)
    this.failed = !landed
    if (landed) this.clearDraft()
    this.publish()
  }

  private projection(): ProjectModelsPageState {
    const snapshot = this.scope.getSnapshot()
    const rules = this.rules()
    const problems = validate(rules)
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.draft !== undefined && !sameStored(this.current(), toStored(this.draft)),
      invalid: Object.keys(problems).length > 0 || this.conflicted,
      saving: this.saving,
      failed: this.failed,
      rules,
      problems,
      catalog: this.catalog,
      catalogStatus: this.catalogStatus,
      conflicted: this.conflicted,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }
}
