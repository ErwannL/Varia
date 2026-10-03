import type { MessageKey } from '@varia/i18n'
import { useApi } from '../api.js'
import { Breadcrumbs, Load } from '../components/Common.js'
import { messages, useI18n } from '../i18n.js'
import { trail } from './Trail.js'

/** Libellé traduit si la clé existe, sinon le code brut (donnée, jamais un texte inventé). */
const known = (key: string): key is MessageKey => key in messages.fr

interface Caps {
  adapter: string
  declared: Record<string, boolean>
  verified: Record<string, { status: string; reason: string | null }> | null
  verifiedAt: string | null
  limitations: string[]
}

/** Capacités déclarées / vérifiées et limites du run (CDC §26 niveau 2). Texte, jamais couleur seule. */
export function Capabilities({ runId }: { runId: string }) {
  const { t } = useI18n()
  const data = useApi<Caps>(`/api/v1/runs/${encodeURIComponent(runId)}/capabilities`)
  return (
    <section aria-labelledby="caps-title">
      <Breadcrumbs
        items={[...trail(t, runId).slice(0, 2), { label: t('dash.nav.capabilities') }]}
      />
      <h1 id="caps-title">{t('dash.capsPage.title')}</h1>
      <Load value={data}>
        {(c) => (
          <>
            <p className="muted">{t('dash.capsPage.adapter', { adapter: c.adapter })}</p>
            <p className="muted">
              {c.verifiedAt === null
                ? t('report.capabilities.neverVerified')
                : t('report.capabilities.verifiedAt', { date: c.verifiedAt })}
            </p>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('dash.capsPage.name')}</th>
                  <th scope="col">{t('dash.capsPage.declared')}</th>
                  <th scope="col">{t('dash.capsPage.verified')}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(c.declared).map(([name, declared]) => {
                  const v = c.verified?.[name]
                  return (
                    <tr key={name}>
                      <td>
                        {known(`report.cap.${name}`) ? (
                          t(`report.cap.${name}` as MessageKey)
                        ) : (
                          <code>{name}</code>
                        )}
                      </td>
                      <td>{declared ? t('dash.capsPage.yes') : t('dash.capsPage.no')}</td>
                      <td data-verified={v?.status ?? 'NONE'}>
                        {v === undefined
                          ? t('dash.capsPage.unverified')
                          : t(`report.capStatus.${v.status}` as MessageKey)}
                        {v?.reason ? (
                          <span className="muted">
                            {' · '}
                            {known(`report.capReason.${v.reason}`) ? (
                              t(`report.capReason.${v.reason}` as MessageKey)
                            ) : (
                              <code>{v.reason}</code>
                            )}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <h2>{t('dash.capsPage.limitations')}</h2>
            <ul className="plain">
              {c.limitations.map((l) => (
                <li key={l}>{t(`dash.limitation.${l}` as MessageKey)}</li>
              ))}
            </ul>
          </>
        )}
      </Load>
    </section>
  )
}
