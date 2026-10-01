import { useState } from 'react'
import { useI18n } from '../i18n.js'
import { href, inIframe } from '../router.js'

/** En-tête de marque : « Varia » en avant, « par Orqea » secondaire sur la même ligne (prompt §4.1). */
export function Header({ orqeaUrl, nav }: { orqeaUrl: string; nav: React.ReactNode }) {
  const { t, locale, setLocale } = useI18n()
  const [hover, setHover] = useState(false)
  const framed = inIframe()
  return (
    <header className="header">
      <div className="header-row">
        <a
          className="brand"
          href={href([])}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
        >
          <img
            className="brand-logo"
            src={hover ? '/varia-animated.svg' : '/varia.svg'}
            width={36}
            height={36}
            alt=""
            data-testid="brand-logo"
          />
          <span className="brand-name">Varia</span>
          <span className="brand-byline" data-testid="byline">
            {t('byline')}
          </span>
        </a>
        <div className="header-tools">
          {framed ? null : (
            <a className="back-link" href={orqeaUrl} target="_top" data-testid="back-to-orqea">
              {t('backToOrqea')}
            </a>
          )}
          <Segmented
            label={t('dash.lang.label')}
            value={locale}
            options={[
              { value: 'fr', label: 'FR' },
              { value: 'en', label: 'EN' },
            ]}
            onChange={(v) => setLocale(v === 'en' ? 'en' : 'fr')}
          />
          <ThemeToggle />
        </div>
      </div>
      {nav}
    </header>
  )
}

export function Footer({ orqeaUrl }: { orqeaUrl: string }) {
  const { t } = useI18n()
  return (
    <footer className="footer">
      <a href={orqeaUrl} target="_top" data-testid="powered-by">
        {t('poweredBy')}
      </a>
      <span aria-hidden="true">·</span>
      <a
        href="https://github.com/ErwannL"
        target="_blank"
        rel="noreferrer noopener"
        data-testid="author"
      >
        {t('author')}
      </a>
    </footer>
  )
}

/** Groupe de boutons à choix unique (remplace un menu déroulant natif, prompt §4.4). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange(v: T): void
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'seg on' : 'seg'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const THEME_KEY = 'varia.theme'

function ThemeToggle() {
  const { t } = useI18n()
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light',
  )
  const apply = (v: 'light' | 'dark') => {
    setTheme(v)
    document.documentElement.dataset['theme'] = v
    try {
      window.localStorage.setItem(THEME_KEY, v)
    } catch {
      // stockage indisponible
    }
  }
  return (
    <Segmented
      label={t('dash.theme.label')}
      value={theme}
      options={[
        { value: 'light', label: t('dash.theme.light') },
        { value: 'dark', label: t('dash.theme.dark') },
      ]}
      onChange={apply}
    />
  )
}
