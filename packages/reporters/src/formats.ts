import { AUTHOR_URL, issueTitle, t, type Locale, type MessageKey } from '@varia/i18n'
import type { Report } from './schema.js'

export const esc = (s: unknown): string =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

/** Logo fixe inline (le rapport HTML est autonome : aucune ressource externe). */
export const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="40" height="40" role="img" aria-label="Varia"><title>Varia</title><rect x="2" y="2" width="60" height="60" rx="15" fill="#4B32D6"/><path d="M15 19 L30 47 L45 19" fill="none" stroke="#FFFFFF" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="49" cy="15" r="5.5" fill="#FFC857"/></svg>'

const COUNT_KEYS = [
  'crashes',
  'timeouts',
  'unexpected',
  'suspicious',
  'handled',
  'expected',
  'passed',
  'skipped',
  'infra',
  'pending',
] as const

/** Rapport HTML autonome (CDC §31) : signature en en-tête et en pied (prompt §4.2), tout échappé. */
export function toHtml(r: Report, locale: Locale, orqeaUrl: string): string {
  const tr = (k: MessageKey, p: Record<string, string | number> = {}) =>
    esc(t(locale, k, Object.fromEntries(Object.entries(p).map(([a, b]) => [a, String(b)]))))
  const counts = COUNT_KEYS.map(
    (k) =>
      `<div class="c"><span>${tr(`dash.count.${k}` as MessageKey)}</span><b>${String(r.counts[k])}</b></div>`,
  ).join('')
  const issues =
    r.issues.length === 0
      ? `<p>${tr('report.noIssues')}</p>`
      : `<table><thead><tr><th>${tr('report.col.severity')}</th><th>${tr('report.col.state')}</th><th>${tr('report.col.issue')}</th><th>${tr('report.col.count')}</th><th>${tr('report.col.replay')}</th></tr></thead><tbody>${r.issues
          .map(
            (i) =>
              `<tr><td>${tr(`dash.severity.${i.severity}` as MessageKey)}</td><td>${esc(i.state)}</td><td>${esc(issueTitle(locale, i))}${i.transitive ? ` <em>(${tr('report.transitive')})</em>` : ''}</td><td>${String(i.count)}</td><td><code>${esc(i.replay)}</code></td></tr>`,
          )
          .join('')}</tbody></table>`
  const nc = r.notCovered
  const list = (k: MessageKey, xs: string[]) =>
    `<h3>${tr(k)} (${String(xs.length)})</h3>${xs.length === 0 ? '' : `<ul>${xs.map((x) => `<li><code>${esc(x)}</code></li>`).join('')}</ul>`}`
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${tr('report.title', { project: r.project.name })}</title>
<style>
:root{--bg:#fff;--fg:#17152e;--mu:#4f4b6b;--ac:#4b32d6;--su:#f5f4fb;--bo:#c9c5e0;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0e0c1d;--fg:#eeedf7;--mu:#b7b3d1;--ac:#b9adff;--su:#191630;--bo:#4a4570}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
header,footer,main{max-width:68rem;margin:0 auto;padding:1rem 1.25rem}header{display:flex;align-items:center;gap:.6rem;border-bottom:1px solid var(--bo)}
.name{font-size:1.5rem;font-weight:750}.by{color:var(--mu);font-size:.85rem}a{color:var(--ac)}.mu{color:var(--mu)}
.cs{display:grid;grid-template-columns:repeat(auto-fill,minmax(8.5rem,1fr));gap:.5rem}.c{background:var(--su);border:1px solid var(--bo);border-radius:8px;padding:.4rem .7rem}.c span{display:block;color:var(--mu);font-size:.85rem}.c b{font-size:1.4rem}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.4rem;border-bottom:1px solid var(--bo);vertical-align:top}
footer{border-top:1px solid var(--bo);text-align:center;color:var(--mu);font-size:.9rem}
</style></head><body>
<header>${LOGO_SVG}<span class="name">Varia</span><span class="by">${tr('byline')}</span></header>
<main>
<h1>${tr('report.title', { project: r.project.name })}</h1>
<p class="mu">${tr('report.run', { id: r.run.id, seed: r.run.seed ?? '—', state: r.run.state, date: r.run.updatedAt })}</p>
${r.counts.pending > 0 ? `<p>${tr('report.partial', { pending: r.counts.pending })}</p>` : ''}
<h2>${tr('report.counts')}</h2><div class="cs">${counts}</div>
<h2>${tr('report.issues')}</h2>${issues}
<h2>${tr('report.notCovered')}</h2>
${list('dash.notCovered.neverCalled', nc.neverCalled)}${list('dash.notCovered.transitiveOnly', nc.transitiveOnly)}${list('dash.notCovered.unsupported', nc.unsupported)}${list('dash.notCovered.flaky', nc.flakyTests)}
<h2>${tr('report.limitations')}</h2><ul>${r.limitations.map((l) => `<li>${tr(`dash.limitation.${l}` as MessageKey)}</li>`).join('')}</ul>
<h2>${tr('report.repro')}</h2><p class="mu"><code>seed=${esc(r.reproducibility.seed ?? '')} config=${esc(r.reproducibility.configHash.slice(0, 12))} env=${esc(r.reproducibility.envHash.slice(0, 12))} commit=${esc(r.reproducibility.gitCommit ?? '—')} varia=${esc(r.reproducibility.variaVersion)}</code></p>
</main>
<footer><a href="${esc(orqeaUrl)}" target="_top">${tr('poweredBy')}</a> · <a href="${esc(AUTHOR_URL)}" target="_blank" rel="noreferrer noopener">${tr('author')}</a></footer>
</body></html>
`
}

/** JUnit XML : une suite par target, un cas par mutation ; échec si le statut est dans `failOn`. */
export function toJUnit(r: Report, failOn: string[]): string {
  const byTarget = new Map<string, Report['mutations']>()
  for (const m of r.mutations) byTarget.set(m.target, [...(byTarget.get(m.target) ?? []), m])
  const statusOf = (m: Report['mutations'][number]) =>
    m.subtype === 'SUSPICIOUS_ACCEPT' ? 'SUSPICIOUS_ACCEPT' : (m.status ?? 'PENDING')
  const suites = [...byTarget.entries()].map(([target, ms]) => {
    const failures = ms.filter((m) => failOn.includes(statusOf(m))).length
    const skipped = ms.filter((m) => m.status === null || m.status === 'SKIPPED').length
    const cases = ms
      .map((m) => {
        const s = statusOf(m)
        const body = failOn.includes(s)
          ? `<failure type="${esc(s)}" message="${esc(m.error ? `${m.error.name}: ${m.error.message}` : s)}">${esc(`varia replay ${m.id}`)}</failure>`
          : m.status === null || m.status === 'SKIPPED'
            ? `<skipped message="${esc(m.reason ?? 'PENDING')}"/>`
            : ''
        return `    <testcase classname="${esc(target)}" name="${esc(`${m.id} ${m.path} ${m.strategy}`)}" time="${((m.durationMs ?? 0) / 1000).toFixed(3)}">${body}</testcase>`
      })
      .join('\n')
    return `  <testsuite name="${esc(target)}" tests="${String(ms.length)}" failures="${String(failures)}" skipped="${String(skipped)}">\n${cases}\n  </testsuite>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="varia" tests="${String(r.mutations.length)}">\n${suites.join('\n')}\n</testsuites>\n`
}

/** SARIF 2.1.0 : une règle par type d'issue, un résultat par issue, localisé par le premier cadre du projet. */
export function toSarif(r: Report): string {
  const level = (s: string) =>
    s === 'CRITICAL' || s === 'HIGH' ? 'error' : s === 'MEDIUM' ? 'warning' : 'note'
  const kinds = [...new Set(r.issues.map((i) => i.kind))].sort()
  const location = (frame: string | null) => {
    const m = frame === null ? null : /\(([^():]+):(\d+)\)$/.exec(frame)
    return m
      ? [
          {
            physicalLocation: {
              artifactLocation: { uri: m[1] },
              region: { startLine: Number(m[2]) },
            },
          },
        ]
      : []
  }
  return (
    JSON.stringify(
      {
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        version: '2.1.0',
        runs: [
          {
            tool: {
              driver: {
                name: 'Varia',
                version: r.varia.version,
                informationUri: 'https://github.com/ErwannL/Varia',
                rules: kinds.map((k) => ({ id: `varia/${k}`, name: k })),
              },
            },
            results: r.issues.map((i) => ({
              ruleId: `varia/${i.kind}`,
              level: level(i.severity),
              message: {
                text: `${issueTitle('en', i)} (${String(i.count)} mutations) — ${i.replay}`,
              },
              locations: location(i.frame),
              partialFingerprints: { variaIssue: i.id },
              properties: { severity: i.severity, state: i.state, target: i.target },
            })),
          },
        ],
      },
      null,
      2,
    ) + '\n'
  )
}

/** Résumé Markdown (commentaire de PR, résumé de job). */
export function toMarkdown(r: Report, locale: Locale): string {
  const c = r.counts
  const rows = r.issues.map(
    (i) =>
      `| ${t(locale, `dash.severity.${i.severity}` as MessageKey)} | ${i.state} | ${issueTitle(locale, i).replace(/\|/g, '\\|')}${i.transitive ? ` _(${t(locale, 'report.transitive')})_` : ''} | ${String(i.count)} | \`${i.replay}\` |`,
  )
  return [
    `# ${t(locale, 'report.title', { project: r.project.name })}`,
    '',
    t(locale, 'cli.summary.executed', {
      planned: String(c.mutations),
      executed: String(c.mutations - c.pending),
      skipped: String(c.skipped),
      pending: String(c.pending),
    }),
    '',
    `| ${t(locale, 'report.col.severity')} | ${t(locale, 'report.col.state')} | ${t(locale, 'report.col.issue')} | ${t(locale, 'report.col.count')} | ${t(locale, 'report.col.replay')} |`,
    '|---|---|---|---|---|',
    ...rows,
    '',
    `${t(locale, 'poweredBy')} · ${t(locale, 'author')}`,
    '',
  ].join('\n')
}
