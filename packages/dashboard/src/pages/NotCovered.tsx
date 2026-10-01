import type { MessageKey } from '@varia/i18n'
import { useApi } from '../api.js'
import { Load } from '../components/Common.js'
import { useI18n } from '../i18n.js'
import type { NotCovered as Data } from '../types.js'

function List({ title, items }: { title: string; items: string[] }) {
  const { t } = useI18n()
  return (
    <>
      <h2>
        {title} ({items.length})
      </h2>
      {items.length === 0 ? (
        <p className="muted">{t('dash.notCovered.none')}</p>
      ) : (
        <ul className="plain">
          {items.map((x) => (
            <li key={x}>
              <code>{x}</code>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** « Not covered » (CDC §26 niveau 1) : ce que Varia n'a PAS observé ni muté, et pourquoi. */
export function NotCovered({ runId }: { runId: string }) {
  const { t } = useI18n()
  const data = useApi<Data>(`/api/v1/runs/${encodeURIComponent(runId)}/not-covered`)
  return (
    <Load value={data}>
      {(d) => {
        const n = d.notCovered
        return (
          <section aria-labelledby="nc-title">
            <h1 id="nc-title">{t('dash.notCovered.title')}</h1>
            <p>{t('dash.notCovered.pending', { count: n.pendingMutations })}</p>
            <List title={t('dash.notCovered.neverCalled')} items={n.neverCalled} />
            <List title={t('dash.notCovered.transitiveOnly')} items={n.transitiveOnly} />
            <List title={t('dash.notCovered.unsupported')} items={n.unsupported} />
            <List
              title={t('dash.notCovered.nonMutable')}
              items={n.nonMutableInputs.map((i) => `${i.target} ${i.path} — ${i.reason}`)}
            />
            <List title={t('dash.notCovered.flaky')} items={n.flakyTests} />
            <List
              title={t('dash.notCovered.skipped')}
              items={n.skippedMutations.map((s) => `${s.id} — ${s.reason}`)}
            />
            <h2>{t('dash.notCovered.limitations')}</h2>
            <ul className="plain">
              {d.limitations.map((l) => (
                <li key={l}>{t(`dash.limitation.${l}` as MessageKey)}</li>
              ))}
            </ul>
          </section>
        )
      }}
    </Load>
  )
}
