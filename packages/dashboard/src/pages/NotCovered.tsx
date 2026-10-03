import type { MessageKey } from '@varia/i18n'
import { useApi } from '../api.js'
import { Load, Pager } from '../components/Common.js'
import { useI18n } from '../i18n.js'
import { href, parseHash } from '../router.js'
import type { NotCovered as Data, Page } from '../types.js'

const LIMIT = 25
type Section = keyof Data['sections']

function List({
  runId,
  section,
  title,
  page,
  render,
}: {
  runId: string
  section: Section
  title: string
  page: Page<unknown>
  render(item: unknown): string
}) {
  const { t } = useI18n()
  return (
    <>
      <h2>{t('dash.notCovered.count', { title, count: page.total })}</h2>
      {page.total === 0 ? (
        <p className="muted">{t('dash.notCovered.none')}</p>
      ) : (
        <>
          <ul className="plain">
            {page.items.map((x) => (
              <li key={render(x)}>
                <code>{render(x)}</code>
              </li>
            ))}
          </ul>
          <Pager
            total={page.total}
            limit={page.limit}
            offset={page.offset}
            onChange={(o) => {
              window.location.hash = href(['runs', runId, 'not-covered'], {
                section,
                page: String(o / LIMIT + 1),
              })
            }}
          />
        </>
      )}
    </>
  )
}

const asText = (x: unknown) => String(x)

/** « Not covered » (CDC §26 niveau 1) : chaque section paginée côté serveur, page dans l'URL. */
export function NotCovered({ runId }: { runId: string }) {
  const { t } = useI18n()
  const query = parseHash(window.location.hash).query
  const section = query.get('section')
  const page = Math.max(1, Math.floor(Number(query.get('page'))) || 1)
  const data = useApi<Data>(
    `/api/v1/runs/${encodeURIComponent(runId)}/not-covered?limit=${String(LIMIT)}${section === null ? '' : `&section=${encodeURIComponent(section)}&offset=${String((page - 1) * LIMIT)}`}`,
  )
  return (
    <Load value={data}>
      {(d) => {
        const s = d.sections
        const list = (key: Section, title: MessageKey, render = asText) => (
          <List
            runId={runId}
            section={key}
            title={t(title)}
            page={s[key] as Page<unknown>}
            render={render}
          />
        )
        return (
          <section aria-labelledby="nc-title">
            <h1 id="nc-title">{t('dash.notCovered.title')}</h1>
            <p>{t('dash.notCovered.pending', { count: d.pendingMutations })}</p>
            {list('neverCalled', 'dash.notCovered.neverCalled')}
            {list('transitiveOnly', 'dash.notCovered.transitiveOnly')}
            {list('unsupported', 'dash.notCovered.unsupported')}
            {list('nonMutableInputs', 'dash.notCovered.nonMutable', (x) => {
              const i = x as { target: string; path: string; reason: string }
              return `${i.target} ${i.path} — ${i.reason}`
            })}
            {list('flakyTests', 'dash.notCovered.flaky')}
            {list('skippedMutations', 'dash.notCovered.skipped', (x) => {
              const m = x as { id: string; reason: string }
              return `${m.id} — ${m.reason}`
            })}
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
