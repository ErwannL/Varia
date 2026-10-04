import type { MessageKey } from '@varia/i18n'
import { useState } from 'react'
import type { Loadable } from '../api.js'
import { useI18n } from '../i18n.js'
import { href } from '../router.js'

/** Chargeur : logo animé (coupé sous prefers-reduced-motion par le SVG lui-même). */
export function Loader() {
  const { t } = useI18n()
  return (
    <div className="loader" role="status" aria-live="polite">
      <img src="/varia-animated.svg" width={72} height={72} alt="" data-testid="loader-logo" />
      <span>{t('dash.loading')}</span>
    </div>
  )
}

export function Load<T>({
  value,
  children,
}: {
  value: Loadable<T>
  children(data: T): React.ReactNode
}) {
  const { t } = useI18n()
  if (value.state === 'loading') return <Loader />
  if (value.state === 'error')
    return (
      <p role="alert" className="error">
        {t('dash.error', { message: value.message })}
      </p>
    )
  return <>{children(value.data)}</>
}

const STATUS_ICON: Record<string, string> = {
  PASSED: 'M5 12l4 4 10-10',
  HANDLED: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z',
  EXPECTED_FAILURE: 'M5 12h14',
  UNEXPECTED_FAILURE: 'M12 7v6M12 17h.01M12 2a10 10 0 100 20 10 10 0 000-20z',
  CRASH: 'M6 6l12 12M18 6L6 18',
  TIMEOUT: 'M12 7v5l3 3M12 2a10 10 0 100 20 10 10 0 000-20z',
  INFRA_ERROR: 'M4 4h16v16H4zM9 9h6v6H9z',
  SKIPPED: 'M5 5l7 7-7 7M13 5l7 7-7 7',
  SUSPICIOUS_ACCEPT: 'M12 3l10 18H2zM12 10v4M12 17h.01',
  PENDING: 'M12 2a10 10 0 100 20 10 10 0 000-20z',
  PLUGIN_FAILURE: 'M4 9h4V5h6v4h4v6h-4v4H8v-4H4zM9 12h6',
}

/** État d'une mutation : icône ET libellé, jamais la couleur seule (prompt §4.4). */
export function StatusBadge({
  status,
  subtype,
}: {
  status: string | null
  subtype?: string | null
}) {
  const { t } = useI18n()
  const key = subtype === 'SUSPICIOUS_ACCEPT' ? 'SUSPICIOUS_ACCEPT' : (status ?? 'PENDING')
  return (
    <span className={`badge badge-${key.toLowerCase()}`} data-status={key}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
        <path
          d={STATUS_ICON[key]}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>{t(`dash.status.${key}` as MessageKey)}</span>
    </span>
  )
}

export function SeverityBadge({ severity }: { severity: string }) {
  const { t } = useI18n()
  const marks: Record<string, string> = {
    CRITICAL: '!!!',
    HIGH: '!!',
    MEDIUM: '!',
    LOW: '·',
    INFO: 'i',
  }
  return (
    <span className={`badge sev-${severity.toLowerCase()}`} data-severity={severity}>
      <span aria-hidden="true" className="sev-mark">
        {marks[severity]}
      </span>
      <span>{t(`dash.severity.${severity}` as MessageKey)}</span>
    </span>
  )
}

export function Pager({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number
  limit: number
  offset: number
  onChange(offset: number): void
}) {
  const { t } = useI18n()
  if (total <= limit) return null
  return (
    <nav
      className="pager"
      aria-label={t('dash.pager.status', {
        from: offset + 1,
        to: Math.min(total, offset + limit),
        total,
      })}
    >
      <button
        type="button"
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        {t('dash.pager.prev')}
      </button>
      <span>
        {t('dash.pager.status', { from: offset + 1, to: Math.min(total, offset + limit), total })}
      </span>
      <button
        type="button"
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
      >
        {t('dash.pager.next')}
      </button>
    </nav>
  )
}

/** Valeur mutée = donnée hostile : affichée comme TEXTE (échappé par React), jamais interprétée. */
export function Value({ value }: { value: unknown }) {
  return (
    <pre className="value">
      {value === undefined ? 'undefined' : JSON.stringify(value, null, 2)}
    </pre>
  )
}

export function CopyButton({ text }: { text: string }) {
  const { t } = useI18n()
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setDone(true))
      }}
    >
      {done ? t('dash.mutation.copied') : t('dash.mutation.copy')}
    </button>
  )
}

export interface Crumb {
  label: string
  path?: string[]
  query?: Record<string, string | undefined>
}

/** Fil d'Ariane Projet → Run → Dossier → Fichier → Test → Call site → Mutation → Erreur (CDC §26). */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const { t } = useI18n()
  return (
    <nav className="crumbs" aria-label={t('dash.crumb.label')}>
      <ol>
        {items.map((c, i) => (
          <li key={`${String(i)}-${c.label}`}>
            {c.path === undefined ? (
              <span aria-current="page">{c.label}</span>
            ) : (
              <a href={href(c.path, c.query)}>{c.label}</a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** Défaillances d'un nœud de l'arbre : nombre ET libellé, jamais la couleur seule. */
export function failuresOf(c: { crashes: number; timeouts: number; unexpected: number }): number {
  return c.crashes + c.timeouts + c.unexpected
}
