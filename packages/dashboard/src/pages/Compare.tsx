import { useApi } from '../api.js'
import { Segmented } from '../components/Brand.js'
import { Load } from '../components/Common.js'
import { useI18n } from '../i18n.js'
import { href } from '../router.js'

interface Diff {
  diff: {
    added: string[]
    removed: string[]
    changed: { id: string; before: number; after: number }[]
    unchanged: string[]
  }
}

/** Comparaison de deux runs (CDC §26 niveau 2) ; le choix est dans l'URL (`#/compare?a=…&b=…`). */
export function Compare({ a, b }: { a: string | null; b: string | null }) {
  const { t } = useI18n()
  const runs = useApi<{ items: { id: string }[] }>('/api/v1/runs?limit=10')
  const ready = a !== null && b !== null && a !== b
  const diff = useApi<Diff>(
    ready ? `/api/v1/runs/${encodeURIComponent(b)}/diff?against=${encodeURIComponent(a)}` : null,
  )
  const go = (na: string | null, nb: string | null) => {
    window.location.hash = href(['compare'], { a: na ?? undefined, b: nb ?? undefined })
  }
  return (
    <section aria-labelledby="cmp-title">
      <h1 id="cmp-title">{t('dash.compare.title')}</h1>
      <Load value={runs}>
        {(p) => {
          const opts = p.items.map((r) => ({ value: r.id, label: r.id }))
          return (
            <div className="compare-pickers">
              <Segmented
                label={t('dash.compare.before')}
                value={a ?? ''}
                options={opts}
                onChange={(v) => go(v, b)}
              />
              <Segmented
                label={t('dash.compare.after')}
                value={b ?? ''}
                options={opts}
                onChange={(v) => go(a, v)}
              />
            </div>
          )
        }}
      </Load>
      {!ready ? (
        <p className="muted">{t('dash.compare.pick')}</p>
      ) : (
        <Load value={diff}>
          {(d) => (
            <>
              <h2>
                {t('dash.compare.added')} ({d.diff.added.length})
              </h2>
              <ul className="plain">
                {d.diff.added.map((id) => (
                  <li key={id}>
                    + <a href={href(['issues', id], { run: b ?? undefined })}>{id}</a>
                  </li>
                ))}
              </ul>
              <h2>
                {t('dash.compare.removed')} ({d.diff.removed.length})
              </h2>
              <ul className="plain">
                {d.diff.removed.map((id) => (
                  <li key={id}>− {id}</li>
                ))}
              </ul>
              <h2>
                {t('dash.compare.changed')} ({d.diff.changed.length})
              </h2>
              <ul className="plain">
                {d.diff.changed.map((c) => (
                  <li key={c.id}>
                    ~ {c.id} : {c.before} → {c.after}
                  </li>
                ))}
              </ul>
              <p className="muted">
                {t('dash.compare.unchanged', { count: d.diff.unchanged.length })}
              </p>
            </>
          )}
        </Load>
      )}
    </section>
  )
}
