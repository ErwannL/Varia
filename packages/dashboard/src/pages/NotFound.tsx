import { useI18n } from '../i18n.js'
import { href } from '../router.js'

/** Page 404 : la signature (en-tête et pied) reste présente via le gabarit. */
export function NotFound() {
  const { t } = useI18n()
  return (
    <section aria-labelledby="nf-title" className="not-found">
      <img src="/varia.svg" width={96} height={96} alt="" />
      <h1 id="nf-title">{t('dash.notFound.title')}</h1>
      <p>{t('dash.notFound.body')}</p>
      <p>
        <a href={href([])}>{t('dash.notFound.home')}</a>
      </p>
    </section>
  )
}
