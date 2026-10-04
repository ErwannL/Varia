import type { MessageKey } from '@varia/i18n'
import { useApi } from '../api.js'
import { Segmented } from '../components/Brand.js'
import { Breadcrumbs, Load, Pager, StatusBadge } from '../components/Common.js'
import { messages, useI18n } from '../i18n.js'
import { href, usePaging } from '../router.js'
import type { Page } from '../types.js'
import { trail } from './Trail.js'

/** Libellé traduit si la clé existe, sinon le code brut (donnée, jamais un texte inventé). */
const known = (key: string): key is MessageKey => key in messages.fr

const PHASES = ['load', 'plan', 'fuzz', 'report'] as const

export interface PluginFailure {
  origin: string
  plugin: string
  extension: string | null
  phase: string
  code: string
  message: string
}
interface PluginsData {
  loaded: {
    name: string
    specifier: string
    apiVersion: number
    version: string | null
    extensions: { kind: string; id: string; disabled: boolean; fileExtension?: string }[]
  }[]
  byPhase: Record<(typeof PHASES)[number], number>
  failures: Page<PluginFailure>
}

/**
 * Extensions chargées pendant le run (rapport v4) et défaillances `PLUGIN_FAILURE`, filtrables par
 * phase. Version : celle que l'extension déclare, sinon la page dit qu'elle n'est pas déclarée.
 */
export function Plugins({ runId, phase }: { runId: string; phase: string | null }) {
  const { t } = useI18n()
  const pg = usePaging(25)
  const ph = phase ?? 'ALL'
  const data = useApi<PluginsData>(
    `/api/v1/runs/${encodeURIComponent(runId)}/plugins?limit=25&offset=${String(pg.offset)}${ph === 'ALL' ? '' : `&phase=${encodeURIComponent(ph)}`}`,
  )
  return (
    <section aria-labelledby="plugins-title">
      <Breadcrumbs items={[...trail(t, runId).slice(0, 2), { label: t('dash.nav.plugins') }]} />
      <h1 id="plugins-title">{t('dash.pluginsPage.title')}</h1>
      <Load value={data}>
        {(d) => {
          const total = PHASES.reduce((n, p) => n + d.byPhase[p], 0)
          return (
            <>
              <h2>{t('dash.pluginsPage.loaded', { count: d.loaded.length })}</h2>
              {d.loaded.length === 0 ? (
                <p className="empty">{t('dash.pluginsPage.none')}</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t('dash.pluginsPage.name')}</th>
                      <th scope="col">{t('dash.pluginsPage.version')}</th>
                      <th scope="col">{t('dash.pluginsPage.apiVersion')}</th>
                      <th scope="col">{t('dash.pluginsPage.extensions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.loaded.map((p) => (
                      <tr key={p.name}>
                        <td>
                          <code>{p.name}</code>
                          <br />
                          <span className="muted">
                            {t('dash.pluginsPage.specifier')} <code>{p.specifier}</code>
                          </span>
                        </td>
                        {p.version === null ? (
                          <td className="muted">{t('dash.pluginsPage.versionUnknown')}</td>
                        ) : (
                          <td>
                            <code>{p.version}</code>
                          </td>
                        )}
                        <td>{p.apiVersion}</td>
                        <td>
                          <ul className="plain">
                            {p.extensions.map((e) => (
                              <li key={e.id} data-disabled={e.disabled}>
                                <code>{e.id}</code> · {t(`dash.pluginKind.${e.kind}` as MessageKey)}{' '}
                                ·{' '}
                                {e.disabled
                                  ? t('dash.pluginsPage.disabled')
                                  : t('dash.pluginsPage.active')}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <h2>{t('dash.pluginsPage.failures', { count: total })}</h2>
              <Segmented
                label={t('dash.pluginsPage.filter')}
                value={ph}
                options={[
                  { value: 'ALL', label: t('dash.pluginsPage.all', { count: total }) },
                  ...PHASES.map((p) => ({
                    value: p,
                    label: t('dash.pluginsPage.phaseOption', {
                      phase: t(`dash.pluginPhase.${p}`),
                      count: d.byPhase[p],
                    }),
                  })),
                ]}
                onChange={(v) => {
                  window.location.hash = href(['runs', runId, 'plugins'], {
                    phase: v === 'ALL' ? undefined : v,
                  })
                }}
              />
              {d.failures.items.length === 0 ? (
                <p className="empty">{t('dash.pluginsPage.noFailures')}</p>
              ) : (
                <>
                  <ul className="cards">
                    {d.failures.items.map((f, i) => (
                      <li key={d.failures.offset + i} className="card">
                        <StatusBadge status="PLUGIN_FAILURE" />
                        <FailureFacts f={f} />
                      </li>
                    ))}
                  </ul>
                  <Pager
                    total={d.failures.total}
                    limit={d.failures.limit}
                    offset={d.failures.offset}
                    onChange={pg.go}
                  />
                </>
              )}
            </>
          )
        }}
      </Load>
    </section>
  )
}

function FailureFacts({ f }: { f: PluginFailure }) {
  const { t } = useI18n()
  return (
    <dl className="facts">
      <dt>{t('dash.pluginsPage.col.plugin')}</dt>
      <dd>
        <code>{f.plugin}</code>
      </dd>
      <dt>{t('dash.pluginsPage.col.extension')}</dt>
      <dd>{f.extension === null ? '—' : <code>{f.extension}</code>}</dd>
      <dt>{t('dash.pluginsPage.col.phase')}</dt>
      <dd>{t(`dash.pluginPhase.${f.phase}` as MessageKey)}</dd>
      <dt>{t('dash.pluginsPage.col.code')}</dt>
      <dd>
        {known(`dash.pluginCode.${f.code}`) ? (
          t(`dash.pluginCode.${f.code}` as MessageKey)
        ) : (
          <code>{f.code}</code>
        )}
      </dd>
      <dt>{t('dash.pluginsPage.col.message')}</dt>
      <dd>
        <code>{f.message}</code>
      </dd>
    </dl>
  )
}
