import { useApi } from '../api.js'
import { Breadcrumbs, failuresOf, Load, Pager } from '../components/Common.js'
import { useI18n } from '../i18n.js'
import { href, usePaging } from '../router.js'
import type { MutationRow, Page } from '../types.js'
import { MutationTable } from './Mutations.js'
import type { NodeCounts, TestRow } from './Tests.js'
import { trail } from './Trail.js'

interface CallSiteRow {
  callSiteId: string
  testId: string
  target: string
  depth: number
  sequence: number
  nonDeterministic: boolean
  counts: NodeCounts
}

const LIMIT = 50

/** Niveau Test : un test, ses call sites (paginés, page dans l'URL). */
export function TestDetail({ runId, testId }: { runId: string; testId: string }) {
  const { t } = useI18n()
  const pg = usePaging(LIMIT)
  const data = useApi<{ runId: string; test: TestRow; callSites: Page<CallSiteRow> }>(
    `/api/v1/tests/${encodeURIComponent(testId)}?run=${encodeURIComponent(runId)}&limit=${String(pg.limit)}&offset=${String(pg.offset)}`,
  )
  return (
    <Load value={data}>
      {(d) => (
        <section aria-labelledby="test-title">
          <Breadcrumbs
            items={trail(t, runId, { file: d.test.file, test: { id: testId, name: d.test.name } })}
          />
          <h1 id="test-title">{t('dash.test.title', { name: d.test.name })}</h1>
          <dl className="facts">
            <dt>{t('dash.test.file')}</dt>
            <dd>
              <a href={href(['runs', runId, 'files', d.test.file])}>
                <code>{d.test.file}</code>
              </a>
            </dd>
            <dt>{t('dash.col.status')}</dt>
            <dd>
              {d.test.status} · {d.test.flaky ? t('dash.test.flaky') : t('dash.test.stable')}
            </dd>
            <dt>{t('dash.col.mutations')}</dt>
            <dd>{d.test.counts.mutations}</dd>
            <dt>{t('dash.col.failures')}</dt>
            <dd>{failuresOf(d.test.counts)}</dd>
          </dl>
          <h2>{t('dash.col.callSites')}</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('dash.col.target')}</th>
                <th scope="col">{t('dash.col.sequence')}</th>
                <th scope="col">{t('dash.col.mutations')}</th>
                <th scope="col">{t('dash.col.failures')}</th>
              </tr>
            </thead>
            <tbody>
              {d.callSites.items.map((c) => (
                <tr key={c.callSiteId}>
                  <td>
                    <a href={href(['runs', runId, 'call-sites', c.callSiteId])}>
                      <code>{c.target}</code>
                    </a>
                    {c.nonDeterministic ? ` · ${t('dash.tests.nd')}` : ''}
                  </td>
                  <td>
                    {c.sequence} · {t('dash.tests.depth', { depth: c.depth })}
                  </td>
                  <td>{c.counts.mutations}</td>
                  <td>{failuresOf(c.counts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager
            total={d.callSites.total}
            limit={d.callSites.limit}
            offset={d.callSites.offset}
            onChange={pg.go}
          />
        </section>
      )}
    </Load>
  )
}

/** Niveau Call site : son test et ses mutations (paginées, page dans l'URL). */
export function CallSite({ runId, callSiteId }: { runId: string; callSiteId: string }) {
  const { t } = useI18n()
  const pg = usePaging(LIMIT)
  const run = encodeURIComponent(runId)
  const site = useApi<{ callSite: CallSiteRow; test: TestRow | null }>(
    `/api/v1/runs/${run}/call-sites/${encodeURIComponent(callSiteId)}`,
  )
  const rows = useApi<Page<MutationRow>>(
    `/api/v1/runs/${run}/mutations?callSite=${encodeURIComponent(callSiteId)}&limit=${String(pg.limit)}&offset=${String(pg.offset)}`,
  )
  return (
    <Load value={site}>
      {(d) => (
        <section aria-labelledby="cs-title">
          <Breadcrumbs
            items={trail(t, runId, {
              ...(d.test === null
                ? {}
                : { file: d.test.file, test: { id: d.test.testId, name: d.test.name } }),
              callSite: { id: callSiteId, target: d.callSite.target },
            })}
          />
          <h1 id="cs-title">
            {t('dash.callSite.title', { target: d.callSite.target, sequence: d.callSite.sequence })}
          </h1>
          <Load value={rows}>
            {(p) => (
              <>
                <MutationTable runId={runId} rows={p.items} />
                <Pager total={p.total} limit={p.limit} offset={p.offset} onChange={pg.go} />
              </>
            )}
          </Load>
        </section>
      )}
    </Load>
  )
}
