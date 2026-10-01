import type { MessageKey } from '@varia/i18n'
import { useApi } from '../api.js'
import { Load, SeverityBadge } from '../components/Common.js'
import { useI18n } from '../i18n.js'
import { href } from '../router.js'
import type { Page, Run, Summary } from '../types.js'

const COUNT_KEYS = [
  'crashes',
  'timeouts',
  'unexpected',
  'suspicious',
  'handled',
  'expected',
  'passed',
  'skipped',
  'infra',
  'pending',
] as const

export function Overview({ runId }: { runId?: string }) {
  const runs = useApi<Page<Run>>(runId === undefined ? '/api/v1/runs?limit=1' : null)
  if (runId !== undefined) return <RunOverview runId={runId} />
  return (
    <Load value={runs}>
      {(p) => (p.items[0] ? <RunOverview runId={p.items[0].id} /> : <Empty />)}
    </Load>
  )
}

function Empty() {
  const { t } = useI18n()
  return <p className="empty">{t('dash.empty.runs')}</p>
}

function RunOverview({ runId }: { runId: string }) {
  const { t } = useI18n()
  const summary = useApi<Summary>(`/api/v1/runs/${encodeURIComponent(runId)}/summary`)
  return (
    <Load value={summary}>
      {(s) => {
        const c = s.counts
        return (
          <section aria-labelledby="overview-title">
            <h1 id="overview-title">{t('dash.overview.title')}</h1>
            <p className="muted">
              {t('dash.overview.run', {
                id: s.run.id,
                seed: s.run.seed ?? '—',
                state: s.run.state,
              })}
            </p>
            {s.critical > 0 ? (
              <p className="callout callout-critical">
                <SeverityBadge severity="CRITICAL" />{' '}
                <a href={href(['runs', runId, 'issues'], { severity: 'CRITICAL' })}>
                  {t('dash.overview.critical', { count: s.critical })}
                </a>
              </p>
            ) : null}
            {s.run.partial ? <p className="callout">{t('dash.overview.partial')}</p> : null}
            <p>
              {t('dash.overview.executed', {
                planned: c.mutations,
                executed: c.mutations - c.pending,
                skipped: c.skipped,
                pending: c.pending,
              })}
            </p>
            <dl className="counts">
              {COUNT_KEYS.map((k) => (
                <div key={k} className={`count count-${k}`}>
                  <dt>{t(`dash.count.${k}` as MessageKey)}</dt>
                  <dd>{c[k]}</dd>
                </div>
              ))}
            </dl>
            <p className="muted">
              {s.resilienceRate === null
                ? t('dash.overview.rateNone')
                : t('dash.overview.rate', { rate: `${(s.resilienceRate * 100).toFixed(1)} %` })}
            </p>
            <p className="muted">
              {t('dash.overview.coverage', {
                mutated: s.coverage.targets.mutated,
                discovered: s.coverage.targets.discovered,
                inputsMutated: s.coverage.inputs.mutated,
                inputsMutable: s.coverage.inputs.mutable,
              })}
            </p>
            <p>
              <a href={href(['runs', runId, 'not-covered'])}>{t('dash.nav.notCovered')}</a>
            </p>
          </section>
        )
      }}
    </Load>
  )
}
