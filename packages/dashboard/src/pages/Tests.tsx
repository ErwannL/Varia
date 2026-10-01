import { useApi } from '../api.js'
import { Load } from '../components/Common.js'
import { useI18n } from '../i18n.js'

interface T {
  testId: string
  file: string
  name: string
  status: string
  flaky: boolean
  callSites: {
    callSiteId: string
    target: string
    depth: number
    sequence: number
    nonDeterministic: boolean
  }[]
}

/** Dossiers → fichiers → tests → call sites (CDC §26 niveau 2). */
export function Tests({ runId }: { runId: string }) {
  const { t } = useI18n()
  const data = useApi<T[]>(`/api/v1/runs/${encodeURIComponent(runId)}/tests`)
  return (
    <section aria-labelledby="tests-title">
      <h1 id="tests-title">{t('dash.tests.title')}</h1>
      <Load value={data}>
        {(tests) => {
          const byFile = new Map<string, T[]>()
          for (const x of tests) byFile.set(x.file, [...(byFile.get(x.file) ?? []), x])
          return [...byFile.entries()].map(([file, list]) => (
            <details key={file} open>
              <summary>
                <code>{file}</code>
              </summary>
              <ul className="plain">
                {list.map((x) => (
                  <li key={x.testId}>
                    {x.name} — {x.status}
                    {x.flaky ? ` (${t('dash.tests.flaky')})` : ''} ·{' '}
                    {t('dash.tests.calls', { count: x.callSites.length })}
                    <ul>
                      {x.callSites.map((c) => (
                        <li key={c.callSiteId}>
                          <code>{c.target}</code> #{c.sequence} ·{' '}
                          {t('dash.tests.depth', { depth: c.depth })}
                          {c.nonDeterministic ? ` · ${t('dash.tests.nd')}` : ''}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </details>
          ))
        }}
      </Load>
    </section>
  )
}
