import { useState } from 'react'
import { useApi } from '../api.js'
import { Load, Pager } from '../components/Common.js'
import { useI18n } from '../i18n.js'
import { href } from '../router.js'
import type { Page, Run } from '../types.js'

export function Runs() {
  const { t } = useI18n()
  const [offset, setOffset] = useState(0)
  const runs = useApi<Page<Run>>(`/api/v1/runs?limit=25&offset=${String(offset)}`)
  return (
    <section aria-labelledby="runs-title">
      <h1 id="runs-title">{t('dash.runs.title')}</h1>
      <Load value={runs}>
        {(p) =>
          p.items.length === 0 ? (
            <p className="empty">{t('dash.empty.runs')}</p>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('dash.runs.id')}</th>
                    <th scope="col">{t('dash.runs.state')}</th>
                    <th scope="col">{t('dash.runs.mode')}</th>
                    <th scope="col">{t('dash.runs.seed')}</th>
                    <th scope="col">{t('dash.runs.date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.items.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <a href={href(['runs', r.id])}>{r.id}</a>
                      </td>
                      <td>{r.state}</td>
                      <td>{r.mode}</td>
                      <td>{r.seed ?? '—'}</td>
                      <td>{r.createdAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager total={p.total} limit={p.limit} offset={p.offset} onChange={setOffset} />
            </>
          )
        }
      </Load>
    </section>
  )
}
