import { useState } from 'react'
import { useApi } from '../api.js'
import { Segmented } from '../components/Brand.js'
import { Load, Pager, SeverityBadge, StatusBadge, Value } from '../components/Common.js'
import { issueTitle } from '@varia/i18n'
import { useI18n } from '../i18n.js'
import { href } from '../router.js'
import type { Issue, MutationRow, Page } from '../types.js'

const SEVERITIES = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const

export function Issues({ runId, severity }: { runId: string; severity: string | null }) {
  const { t, locale } = useI18n()
  const [offset, setOffset] = useState(0)
  const sev = severity ?? 'ALL'
  const issues = useApi<Page<Issue>>(
    `/api/v1/runs/${encodeURIComponent(runId)}/issues?limit=25&offset=${String(offset)}${sev === 'ALL' ? '' : `&severity=${sev}`}`,
  )
  return (
    <section aria-labelledby="issues-title">
      <h1 id="issues-title">{t('dash.issues.title')}</h1>
      <Segmented
        label={t('dash.issues.filter')}
        value={sev}
        options={SEVERITIES.map((s) => ({
          value: s,
          label: s === 'ALL' ? t('dash.issues.all') : t(`dash.severity.${s}`),
        }))}
        onChange={(v) => {
          setOffset(0)
          window.location.hash = href(['runs', runId, 'issues'], {
            severity: v === 'ALL' ? undefined : v,
          })
        }}
      />
      <Load value={issues}>
        {(p) =>
          p.items.length === 0 ? (
            <p className="empty">{t('dash.issues.none')}</p>
          ) : (
            <>
              <ul className="cards">
                {p.items.map((i) => (
                  <li key={i.id} className="card">
                    <SeverityBadge severity={i.severity} />
                    <a className="card-title" href={href(['issues', i.id], { run: runId })}>
                      {issueTitle(locale, i)}
                    </a>
                    <span className="muted">{t('dash.issues.count', { count: i.count })}</span>
                  </li>
                ))}
              </ul>
              <Pager total={p.total} limit={p.limit} offset={p.offset} onChange={setOffset} />
            </>
          )
        }
      </Load>
    </section>
  )
}

interface IssueDetailData {
  issue: Issue
  occurrence: { state: string; count: number } | null
  mutations: MutationRow[]
}

export function IssueDetail({ id, runId }: { id: string; runId: string | null }) {
  const { t, locale } = useI18n()
  const data = useApi<IssueDetailData>(
    `/api/v1/issues/${encodeURIComponent(id)}${runId === null ? '' : `?run=${encodeURIComponent(runId)}`}`,
  )
  return (
    <Load value={data}>
      {(d) => (
        <section aria-labelledby="issue-title">
          <h1 id="issue-title">{issueTitle(locale, d.issue)}</h1>
          <dl className="facts">
            <dt>{t('dash.issue.target')}</dt>
            <dd>
              <code>{d.issue.target}</code>
            </dd>
            <dt>{t('dash.issue.frame')}</dt>
            <dd>
              <code>{d.issue.frame ?? '—'}</code>
            </dd>
            <dt>{t('dash.issue.state')}</dt>
            <dd>{d.occurrence?.state ?? '—'}</dd>
          </dl>
          <SeverityBadge severity={d.issue.severity} />
          <h2>{t('dash.issue.mutations')}</h2>
          <ul className="cards">
            {d.mutations.map((m) => (
              <li key={m.id} className="card">
                <StatusBadge status={m.status} subtype={m.subtype} />
                <a href={href(['mutations', m.id], { run: runId ?? undefined })}>
                  <code>{m.id}</code>
                </a>
                <span>
                  <code>{m.path}</code> · {m.strategy}
                </span>
                <Value value={m.deleted ? undefined : m.value} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </Load>
  )
}
