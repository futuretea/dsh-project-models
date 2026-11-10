/**
 * Project models page, browser half: edits the `project-models` entry's
 * project rules on the bundle's page in Plugins, with the Host model catalog
 * as the choice list.
 */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { ProjectModelsController, PROJECT_MODELS_NS, type CatalogResponse, type ProjectModelsSettings } from './controller.ts'
import { en, zh, type ProjectModelsLocaleKey } from './locales.ts'
import { ProjectModelsPage } from './ProjectModelsPage.tsx'
import { STYLES } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Project models page copy. */
    'settings.projectModels': ProjectModelsLocaleKey
  }
}

const NS = 'settings.projectModels'

/** The npm package name that keys this bundle's configuration page. */
const BUNDLE = 'dsh-project-models'

export const inject = ['slots', 'locale', 'remote', 'remote.session', 'configForms']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'project-models: dictionaries')
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = BUNDLE
    tag.textContent = STYLES
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'project-models: styles')
  const controller = new ProjectModelsController(
    ctx.configForms.get<ProjectModelsSettings>(PROJECT_MODELS_NS),
    () => ctx.remote.session.modelCatalog() as Promise<CatalogResponse>,
  )
  ctx.effect(() => () => { controller.dispose() }, 'project-models: form subscription')
  ctx.effect(() => ctx.remote.$on('llm/adapters-updated', () => { void controller.refreshCatalog() }), 'project-models: adapter invalidations')
  ctx.effect(() => ctx.remote.$on('settings/document-updated', () => { void controller.refreshCatalog() }), 'project-models: settings invalidations')
  ctx.effect(() => ctx.on('connection/reset', () => { controller.resetConnection() }), 'project-models: connection generation')
  const face = controller.inject()
  ctx.effect(() => ctx.configForms.whileServed([PROJECT_MODELS_NS], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: BUNDLE,
    locale: NS,
    inject: () => face,
  }, ProjectModelsPage))), 'project-models: page')
}
