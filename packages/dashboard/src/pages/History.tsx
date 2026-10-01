import { useApi } from '../api.js'
import { Load } from '../components/Common.js'
import { useI18n } from '../i18n.js'
import { href } from '../router.js'

interface Point {
  id: string
  createdAt: string
  state: string
  partial: boolean
  issues: number
  critical: number
  counts: { crashes: number; timeouts: number; mutations: number }
}

/** Historique (CDC §26 niveau 2) : tendance en barres SVG, chaque barre doublée d'un texte (jamais la couleur seule). */
export function History() {
  const { t } = useI18n()
  const data = useApi<Point[]>('/api/v1/history?limit=50')
  return (
    <section aria-labelledby="hist-title">
      <h1 id="hist-title">{t('dash.history.title')}</h1>
      <Load value={data}>
        {(points) => {
          const ordered = [...points].reverse()
          const max = Math.max(1, ...ordered.map((p) => p.counts.crashes + p.counts.timeouts))
          return (
            <>
              <h2>{t('dash.history.trend')}</h2>
              <ol className="trend">
                {ordered.map((p) => {
                  const v = p.counts.crashes + p.counts.timeouts
                  return (
                    <li key={p.id}>
                      <a href={href(['runs', p.id])}>
                        <span
                          className="trend-bar"
                          style={{ width: `${String(Math.max(2, (v / max) * 100))}%` }}
                          aria-hidden="true"
                        />
                        <span className="trend-label">
                          {t('dash.history.bar', {
                            id: p.id,
                            crashes: p.counts.crashes,
                            timeouts: p.counts.timeouts,
                            issues: p.issues,
                          })}
                        </span>
                      </a>
                    </li>
                  )
                })}
              </ol>
            </>
          )
        }}
      </Load>
    </section>
  )
}
