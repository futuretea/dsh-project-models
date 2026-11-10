/** Project models page: one card per project with its main-agent and subagent routes. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SettingsForm } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  routeKey,
  type CatalogModel, type DraftRule, type PathProblem, type ProjectModelsPageFace, type ProjectModelsPageState,
  type RouteSlot, type StoredRoute,
} from './controller.ts'
import type { ProjectModelsLocaleKey } from './locales.ts'

/** Framework-derived props for the page. */
export type ProjectModelsPageProps = PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<'settings.projectModels'> & InjectFace<ProjectModelsPageFace>

type T = (key: ProjectModelsLocaleKey) => string

type PageActions = Omit<ProjectModelsPageFace, 'hooks'>

interface RouteFieldProps {
  t: T
  label: string
  route: StoredRoute | undefined
  catalog: readonly CatalogModel[]
  disabled: boolean
  onRoute: (key: string) => void
  onEffort: (effort: string) => void
}

/** One model picker with its optional reasoning-effort picker. */
function RouteField(props: RouteFieldProps) {
  const { t, route, catalog } = props
  const selectedKey = route === undefined ? '' : routeKey(route)
  const known = catalog.find(model => routeKey(model) === selectedKey)
  const providers = new Map<string, { name: string; models: CatalogModel[] }>()
  for (const model of catalog) {
    const group = providers.get(model.provider)
    if (group === undefined) providers.set(model.provider, { name: model.providerName, models: [model] })
    else group.models.push(model)
  }
  const efforts = known?.efforts ?? []
  return (
    <div className="dpm-field">
      <span className="dpm-label">{props.label}</span>
      <span className="dpm-route">
        <select className="dpm-select" value={selectedKey} disabled={props.disabled} aria-label={props.label}
          onChange={(event) => { props.onRoute(event.target.value) }}>
          <option value="">{t('notSet')}</option>
          {[...providers].map(([provider, group]) => (
            <optgroup key={provider} label={`${group.name} (${provider})`}>
              {group.models.map(model => (
                <option key={routeKey(model)} value={routeKey(model)}>{model.modelName}</option>
              ))}
            </optgroup>
          ))}
          {route !== undefined && known === undefined
            ? <option value={selectedKey}>{`${route.provider}/${route.model} (${t('unavailableModel')})`}</option>
            : null}
        </select>
        {efforts.length > 0
          ? (
            <select className="dpm-select dpm-effort" value={route?.reasoningEffort ?? ''} disabled={props.disabled}
              aria-label={`${props.label} · ${t('effortDefault')}`}
              onChange={(event) => { props.onEffort(event.target.value) }}>
              <option value="">{t('effortDefault')}</option>
              {efforts.map(effort => <option key={effort} value={effort}>{effort}</option>)}
            </select>
          )
          : null}
      </span>
    </div>
  )
}

interface RuleCardProps {
  t: T
  rule: DraftRule
  state: ProjectModelsPageState
  face: PageActions
}

function pathProblem(t: T, problem: PathProblem | undefined): string | undefined {
  if (problem === 'empty') return t('problemEmpty')
  if (problem === 'relative') return t('problemRelative')
  if (problem === 'duplicate') return t('problemDuplicate')
  return undefined
}

/** One project's directory and routes. */
function RuleCard(props: RuleCardProps) {
  const { t, rule, state, face } = props
  const disabled = !state.writable || state.saving
  const pathError = pathProblem(t, state.problems[rule.key])
  const routeProps = (slot: RouteSlot) => ({
    t,
    catalog: state.catalog,
    disabled,
    onRoute: (key: string) => { face.setRoute(rule.key, slot, key) },
    onEffort: (effort: string) => { face.setEffort(rule.key, slot, effort) },
  })
  return (
    <section className="dpm-rule">
      <div className="dpm-rule-head">
        <label className="dpm-field dpm-grow">
          <span className="dpm-label">{t('path')}</span>
          <input className="dpm-input" value={rule.path} placeholder={t('pathPlaceholder')} disabled={disabled}
            aria-invalid={pathError !== undefined}
            onChange={(event) => { face.setPath(rule.key, event.target.value) }} />
        </label>
        <button type="button" className="dpm-link dpm-danger" disabled={disabled}
          onClick={() => { face.removeProject(rule.key) }}>{t('removeProject')}</button>
      </div>
      {pathError === undefined ? null : <p className="dpm-error" role="status">{pathError}</p>}
      <RouteField label={t('main')} route={rule.main} {...routeProps('main')} />
      <RouteField label={t('sub')} route={rule.sub} {...routeProps('sub')} />
    </section>
  )
}

/**
 * Render the project list with one save footer.
 * @param props - locale, the page snapshot, and its staged actions.
 * @returns the summary line or the editable page.
 */
export function ProjectModelsPage(props: ProjectModelsPageProps) {
  const { t } = props
  const state = props.useProjectModelsPage(snapshot => snapshot)
  if (props.view === 'summary') return t('intro')
  const face: PageActions = props
  return (
    <SettingsForm
      labels={{ unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }}
      state={state} onSave={props.save} onDiscard={props.discard}>
      <div className="dpm-page">
        <h3 className="dpm-heading">{t('title')}</h3>
        <p className="dpm-hint">{t('intro')}</p>
        {state.catalogStatus === 'loading' ? <p className="dpm-hint" role="status">{t('catalogLoading')}</p> : null}
        {state.catalogStatus === 'error'
          ? (
            <p className="dpm-error" role="alert">
              {t('catalogFailed')}{' '}
              <button type="button" className="dpm-link" onClick={props.retryCatalog}>{t('retry')}</button>
            </p>
          )
          : null}
        {state.rules.length === 0 ? <p className="dpm-hint">{t('empty')}</p> : null}
        {state.rules.map(rule => <RuleCard key={rule.key} t={t} rule={rule} state={state} face={face} />)}
        <button type="button" className="dpm-link" disabled={!state.writable || state.saving}
          onClick={props.addProject}>{t('addProject')}</button>
        {state.conflicted
          ? (
            <p className="dpm-error" role="status">
              {t('conflict')}{' '}
              <button type="button" className="dpm-link" onClick={props.discard}>{t('discard')}</button>
            </p>
          )
          : null}
      </div>
    </SettingsForm>
  )
}
