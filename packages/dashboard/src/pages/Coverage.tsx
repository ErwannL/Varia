import type { MessageKey } from '@varia/i18n'
import { useApi } from '../api.js'
import { Load } from '../components/Common.js'
import { useI18n } from '../i18n.js'

interface Cov {
  baseline: {
    status: string
    files: {
      file: string
      lines: number | null
      branches: number | null
      functions: number | null
    }[]
  }
  mutation: {
    targets: { discovered: number; mutated: number }
    inputs: { mutable: number; mutated: number }
  }
}

/** Métrique de baseline : `null` = inconnue (B-07), dite comme telle, jamais 0. */
function Metric({ value }: { value: number | null }) {
  const { t } = useI18n()
  return <>{value === null ? t('report.unknown') : `${String(value)} %`}</>
}

export function Coverage({ runId }: { runId: string }) {
  const { t } = useI18n()
  const pct = (v: number | null) => <Metric value={v} />
  const data = useApi<Cov>(`/api/v1/runs/${encodeURIComponent(runId)}/coverage`)
  return (
    <section aria-labelledby="cov-title">
      <h1 id="cov-title">{t('dash.coverage.title')}</h1>
      <Load value={data}>
        {(c) => (
          <>
            <p>
              {t('dash.overview.coverage', {
                mutated: c.mutation.targets.mutated,
                discovered: c.mutation.targets.discovered,
                inputsMutated: c.mutation.inputs.mutated,
                inputsMutable: c.mutation.inputs.mutable,
              })}
            </p>
            <h2>{t('dash.coverage.baseline')}</h2>
            <p className="muted">{t(`dash.coverage.status.${c.baseline.status}` as MessageKey)}</p>
            {c.baseline.files.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('dash.coverage.col.file')}</th>
                    <th scope="col">{t('dash.coverage.col.lines')}</th>
                    <th scope="col">{t('dash.coverage.col.branches')}</th>
                    <th scope="col">{t('dash.coverage.col.functions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.baseline.files.map((f) => (
                    <tr key={f.file}>
                      <td>
                        <code>{f.file}</code>
                      </td>
                      <td>{pct(f.lines)}</td>
                      <td>{pct(f.branches)}</td>
                      <td>{pct(f.functions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        )}
      </Load>
    </section>
  )
}
