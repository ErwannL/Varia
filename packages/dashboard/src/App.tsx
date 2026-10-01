import type { Locale } from '@varia/i18n'
import { useEffect } from 'react'
import { useApi, type Health } from './api.js'
import { Footer, Header } from './components/Brand.js'
import { Loader } from './components/Common.js'
import { I18nProvider, useI18n } from './i18n.js'
import { IssueDetail, Issues } from './pages/Issues.js'
import { MutationDetail, Mutations } from './pages/Mutations.js'
import { NotCovered } from './pages/NotCovered.js'
import { NotFound } from './pages/NotFound.js'
import { Overview } from './pages/Overview.js'
import { Runs } from './pages/Runs.js'
import { href, useRoute, type Route } from './router.js'

export const DEFAULT_ORQEA_URL = 'https://orqea.dev'

function Nav({ route, latestRun }: { route: Route; latestRun: string | null }) {
  const { t } = useI18n()
  const runId = route.path[0] === 'runs' && route.path[1] !== undefined ? route.path[1] : latestRun
  const links: [string, string, string[]][] = [
    ['overview', t('dash.nav.overview'), runId === null ? [] : ['runs', runId]],
    ['runs', t('dash.nav.runs'), ['runs']],
    ...(runId === null
      ? []
      : ([
          ['issues', t('dash.nav.issues'), ['runs', runId, 'issues']],
          ['mutations', t('dash.nav.mutations'), ['runs', runId, 'mutations']],
          ['not-covered', t('dash.nav.notCovered'), ['runs', runId, 'not-covered']],
        ] as [string, string, string[]][])),
  ]
  const current = href(route.path)
  return (
    <nav className="nav" aria-label={t('dash.nav.label')}>
      {links.map(([key, label, path]) => (
        <a key={key} href={href(path)} aria-current={href(path) === current ? 'page' : undefined}>
          {label}
        </a>
      ))}
    </nav>
  )
}

function Page({ route }: { route: Route }) {
  const [a, b, c] = route.path
  const run = route.query.get('run')
  if (a === undefined) return <Overview />
  if (a === 'runs' && b === undefined) return <Runs />
  if (a === 'runs' && b !== undefined && c === undefined) return <Overview runId={b} />
  if (a === 'runs' && b !== undefined && c === 'issues')
    return <Issues runId={b} severity={route.query.get('severity')} />
  if (a === 'runs' && b !== undefined && c === 'mutations')
    return <Mutations runId={b} status={route.query.get('status')} />
  if (a === 'runs' && b !== undefined && c === 'not-covered') return <NotCovered runId={b} />
  if (a === 'issues' && b !== undefined) return <IssueDetail id={b} runId={run} />
  if (a === 'mutations' && b !== undefined) return <MutationDetail id={b} runId={run} />
  return <NotFound />
}

function Shell() {
  const { t, locale } = useI18n()
  const route = useRoute()
  const health = useApi<Health>('/health')
  const runs = useApi<{ items: { id: string }[] }>('/api/v1/runs?limit=1')
  useEffect(() => {
    document.documentElement.lang = locale
    document.title = t('dash.title')
  }, [locale, t])
  if (health.state === 'loading') return <Loader />
  const orqeaUrl = health.state === 'ready' ? health.data.orqeaUrl : DEFAULT_ORQEA_URL
  const latest = runs.state === 'ready' ? (runs.data.items[0]?.id ?? null) : null
  return (
    <>
      <a className="skip" href="#main">
        {t('dash.skip')}
      </a>
      <Header orqeaUrl={orqeaUrl} nav={<Nav route={route} latestRun={latest} />} />
      <main id="main" tabIndex={-1}>
        <Page route={route} />
      </main>
      <Footer orqeaUrl={orqeaUrl} />
    </>
  )
}

export function App({ locale }: { locale?: Locale }) {
  return (
    <I18nProvider {...(locale !== undefined ? { locale } : {})}>
      <Shell />
    </I18nProvider>
  )
}
