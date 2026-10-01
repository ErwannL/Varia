import { useState } from 'react'
import { useApi } from '../api.js'
import { Segmented } from '../components/Brand.js'
import { CopyButton, Load, Pager, StatusBadge, Value } from '../components/Common.js'
import { useI18n } from '../i18n.js'
import { href } from '../router.js'
import type { MutationRow, Page } from '../types.js'

const STATUSES = [
  'ALL',
  'CRASH',
  'TIMEOUT',
  'UNEXPECTED_FAILURE',
  'PASSED',
  'HANDLED',
  'SKIPPED',
] as const

export function Mutations({ runId, status }: { runId: string; status: string | null }) {
  const { t } = useI18n()
  const [offset, setOffset] = useState(0)
  const st = status ?? 'ALL'
  const rows = useApi<Page<MutationRow>>(
    `/api/v1/runs/${encodeURIComponent(runId)}/mutations?limit=50&offset=${String(offset)}${st === 'ALL' ? '' : `&status=${st}`}`,
  )
  return (
    <section aria-labelledby="mutations-title">
      <h1 id="mutations-title">{t('dash.mutations.title')}</h1>
      <Segmented
        label={t('dash.mutations.filter')}
        value={st}
        options={STATUSES.map((s) => ({
          value: s,
          label: s === 'ALL' ? t('dash.issues.all') : t(`dash.status.${s}`),
        }))}
        onChange={(v) => {
          setOffset(0)
          window.location.hash = href(['runs', runId, 'mutations'], {
            status: v === 'ALL' ? undefined : v,
          })
        }}
      />
      <Load value={rows}>
        {(p) => (
          <>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('dash.mutation.result')}</th>
                  <th scope="col">{t('dash.mutation.target')}</th>
                  <th scope="col">{t('dash.mutation.path')}</th>
                  <th scope="col">{t('dash.mutation.strategy')}</th>
                  <th scope="col">{t('dash.mutations.title')}</th>
                </tr>
              </thead>
              <tbody>
                {p.items.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <StatusBadge status={m.status} subtype={m.subtype} />
                    </td>
                    <td>
                      <code>{m.target}</code>
                    </td>
                    <td>
                      <code>{m.path}</code>
                    </td>
                    <td>{m.strategy}</td>
                    <td>
                      <a href={href(['mutations', m.id], { run: runId })}>
                        <code>{m.id}</code>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager total={p.total} limit={p.limit} offset={p.offset} onChange={setOffset} />
          </>
        )}
      </Load>
    </section>
  )
}

interface MutationDetailData {
  runId: string
  mutation: {
    id: string
    module: string
    export: string
    testName: string
    pathStr: string
    strategy: string
    original: unknown
    value: unknown
    op: string
  }
  result: {
    status: string
    subtype: string | null
    reason: string | null
    echoPath: string | null
    error: { name: string; message: string; stack?: string } | null
  } | null
  replay: string
}

export function MutationDetail({ id, runId }: { id: string; runId: string | null }) {
  const { t } = useI18n()
  const data = useApi<MutationDetailData>(
    `/api/v1/mutations/${encodeURIComponent(id)}${runId === null ? '' : `?run=${encodeURIComponent(runId)}`}`,
  )
  return (
    <Load value={data}>
      {(d) => (
        <section aria-labelledby="mutation-title">
          <h1 id="mutation-title">{t('dash.mutation.title', { id })}</h1>
          <StatusBadge status={d.result?.status ?? null} subtype={d.result?.subtype ?? null} />
          <dl className="facts">
            <dt>{t('dash.mutation.target')}</dt>
            <dd>
              <code>
                {d.mutation.module}#{d.mutation.export}
              </code>
            </dd>
            <dt>{t('dash.mutation.test')}</dt>
            <dd>{d.mutation.testName}</dd>
            <dt>{t('dash.mutation.path')}</dt>
            <dd>
              <code>{d.mutation.pathStr}</code>
            </dd>
            <dt>{t('dash.mutation.strategy')}</dt>
            <dd>{d.mutation.strategy}</dd>
            {d.result?.reason ? (
              <>
                <dt>{t('dash.mutation.reason')}</dt>
                <dd>
                  {d.result.reason}
                  {d.result.echoPath ? <code> {d.result.echoPath}</code> : null}
                </dd>
              </>
            ) : null}
          </dl>
          <div className="two-col">
            <div>
              <h2>{t('dash.mutation.original')}</h2>
              <Value value={d.mutation.original} />
            </div>
            <div>
              <h2>{t('dash.mutation.mutated')}</h2>
              {d.mutation.op === 'delete' ? (
                <p>{t('dash.mutation.deleted')}</p>
              ) : (
                <Value value={d.mutation.value} />
              )}
            </div>
          </div>
          {d.result?.error ? (
            <>
              <h2>{t('dash.mutation.error')}</h2>
              <p>
                <code>
                  {d.result.error.name}: {d.result.error.message}
                </code>
              </p>
              {d.result.error.stack ? (
                <>
                  <h3>{t('dash.mutation.stack')}</h3>
                  <pre className="value">{d.result.error.stack}</pre>
                </>
              ) : null}
            </>
          ) : null}
          <h2>{t('dash.mutation.replay')}</h2>
          <p className="replay">
            <code>{d.replay}</code> <CopyButton text={d.replay} />
          </p>
        </section>
      )}
    </Load>
  )
}
