import { AUTHOR_URL, issueTitle, messages, t, type Locale, type MessageKey } from '@varia/i18n'
import type { Report } from './schema.js'

/** Caractères interdits en XML 1.0 (contrôles, substituts isolés, U+FFFE/U+FFFF) : retirés. */
const XML_INVALID = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu

/** Texte sûr en XML 1.0 : caractères interdits retirés (valeurs hostiles des messages d'erreur). */
export const xmlText = (s: unknown): string => String(s).replace(XML_INVALID, '')

export const esc = (s: unknown): string =>
  xmlText(s).replace(
    /[&<>"']/g,
    // La classe de caractères garantit une clé connue : aucune autre valeur possible.
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )

/** Valeur d'attribut XML : tabulation et fins de ligne en références (sinon normalisées en espaces). */
export const xmlAttr = (s: unknown): string =>
  esc(s).replace(/[\t\n\r]/g, (c) => `&#${String(c.charCodeAt(0))};`)

/**
 * Logo inline (le rapport HTML est autonome : aucune ressource externe) : copie EXACTE de
 * `brand/varia.svg`, seul l'`id` du `<title>` est propre au rapport (un test compare les tracés).
 */
export const LOGO_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-labelledby="varia-report-logo-title">',
  '  <title id="varia-report-logo-title">Varia</title>',
  '  <rect x="2" y="2" width="60" height="60" rx="15" fill="#4B32D6"/>',
  '  <path d="M21 13 C15.5 13 16 18 16 23.5 C16 28.5 14.5 31 11 32 C14.5 33 16 35.5 16 40.5 C16 46 15.5 51 21 51" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>',
  '  <path d="M43 13 C48.5 13 48 18 48 23.5 C48 28.5 49.5 31 53 32 C49.5 33 48 35.5 48 40.5 C48 46 48.5 51 43 51" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>',
  '  <path d="M38.5 14 L24 35 L31 35 L27.5 50 L41 28.5 L34 28.5 Z" fill="#FFC857" stroke="#FFC857" stroke-width="2" stroke-linejoin="round"/>',
  '</svg>',
].join('\n')

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

const METRICS = ['lines', 'statements', 'functions', 'branches'] as const
const COVERAGE_COLS = ['file', ...METRICS] as const

/** Pourcentage de couverture ; `null` (inconnu, B-07) affiché « — », jamais 100 %. */
const pct = (locale: Locale, v: number | null): string =>
  v === null ? t(locale, 'report.unknown') : `${String(v)} %`

/** Traduction échappée ; une clé absente (code inconnu) est rendue telle quelle, jamais devinée. */
function translator(locale: Locale) {
  const tr = (k: MessageKey, p: Record<string, string | number> = {}) =>
    esc(t(locale, k, Object.fromEntries(Object.entries(p).map(([a, b]) => [a, String(b)]))))
  const trOr = (k: string, raw: string) => (k in messages[locale] ? tr(k as MessageKey) : esc(raw))
  return { tr, trOr }
}

/** Rapport HTML autonome (CDC §31) : signature en en-tête et en pied (prompt §4.2), tout échappé. */
export function toHtml(r: Report, locale: Locale, orqeaUrl: string): string {
  const { tr, trOr } = translator(locale)
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
              `<tr><td>${tr(`dash.severity.${i.severity}` as MessageKey)}</td><td>${trOr(`issue.state.${i.state}`, i.state)}</td><td>${esc(issueTitle(locale, i))}${i.transitive ? ` <em>(${tr('report.transitive')})</em>` : ''}${i.matchedFrom.length === 0 ? '' : ` <small class="mu">(${tr('report.matchedFrom', { ids: i.matchedFrom.join(', ') })})</small>`}</td><td>${String(i.count)}</td><td><code>${esc(i.replay)}</code></td></tr>`,
          )
          .join('')}</tbody></table>`
  const nc = r.notCovered
  const items = (xs: string[]) =>
    xs.length === 0 ? '' : `<ul>${xs.map((x) => `<li><code>${esc(x)}</code></li>`).join('')}</ul>`
  const list = (k: MessageKey, xs: string[]) =>
    `<h3>${tr(k)} (${String(xs.length)})</h3>${items(xs)}`
  const caps = r.capabilities
  const capRows = Object.entries(caps.verified)
    .map(
      ([k, v]) =>
        `<tr><td>${trOr(`report.cap.${k}`, k)}</td><td>${tr(caps.declared[k] === true ? 'report.yes' : 'report.no')}</td><td class="st-${v.status}">${tr(`report.capStatus.${v.status}`)}</td><td>${v.reason === null ? '' : trOr(`report.capReason.${v.reason}`, v.reason)}</td></tr>`,
    )
    .join('')
  const b = r.baseline
  const c = r.counts
  const acceptances =
    r.acceptances.length === 0
      ? `<p>${tr('report.noAcceptances')}</p>`
      : `<ul>${r.acceptances
          .map(
            (a) =>
              `<li><code>${esc(a.id)}</code> ${tr('report.acceptance.item', { function: a.function, path: a.path ?? '', reason: a.reason, status: t(locale, `report.acceptanceStatus.${a.status}`), matched: a.matched })}</li>`,
          )
          .join('')}</ul>`
  const rp = r.reproducibility
  const bc = r.baselineCoverage
  const coverage = `<section id="coverage"><h2>${tr('report.coverage')}</h2><p class="mu">${tr(`report.coverage.status.${bc.status}`)}</p>${
    bc.files.length === 0
      ? ''
      : `<table><thead><tr>${COVERAGE_COLS.map((k) => `<th>${tr(`report.col.${k}`)}</th>`).join('')}</tr></thead><tbody>${bc.files
          .map(
            (f) =>
              `<tr><td><code>${esc(f.file)}</code></td>${METRICS.map((k) => `<td>${esc(pct(locale, f[k]))}</td>`).join('')}</tr>`,
          )
          .join('')}</tbody></table>`
  }</section>`
  const partial = r.run.partial ? ` <span class="badge">${tr('report.partialLabel')}</span>` : ''
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${tr('report.title', { project: r.project.name })}</title>
<style>
:root{--bg:#fff;--fg:#17152e;--mu:#4f4b6b;--ac:#4b32d6;--su:#f5f4fb;--bo:#c9c5e0;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0e0c1d;--fg:#eeedf7;--mu:#b7b3d1;--ac:#b9adff;--su:#191630;--bo:#4a4570}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
header,footer,main{max-width:68rem;margin:0 auto;padding:1rem 1.25rem}header{display:flex;align-items:center;gap:.6rem;border-bottom:1px solid var(--bo)}header svg{width:40px;height:40px;flex:none}
.name{font-size:1.5rem;font-weight:750}.by{color:var(--mu);font-size:.85rem}a{color:var(--ac)}.mu{color:var(--mu)}
.badge{display:inline-block;font-size:.8rem;font-weight:700;padding:.1rem .5rem;border-radius:99px;border:1px solid var(--ac);color:var(--ac);vertical-align:middle}
.cs{display:grid;grid-template-columns:repeat(auto-fill,minmax(8.5rem,1fr));gap:.5rem}.c{background:var(--su);border:1px solid var(--bo);border-radius:8px;padding:.4rem .7rem}.c span{display:block;color:var(--mu);font-size:.85rem}.c b{font-size:1.4rem}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.4rem;border-bottom:1px solid var(--bo);vertical-align:top}.st-VERIFIED{font-weight:700}
footer{border-top:1px solid var(--bo);text-align:center;color:var(--mu);font-size:.9rem}
</style></head><body>
<header>${LOGO_SVG}<span class="name">Varia</span><span class="by">${tr('byline')}</span></header>
<main>
<h1>${tr('report.title', { project: r.project.name })}${partial}</h1>
<p class="mu">${tr('report.run', { id: r.run.id, seed: r.run.seed ?? '—', state: r.run.state, date: r.run.updatedAt })}</p>
<p id="partial">${partial === '' ? tr('report.complete') : tr('report.partial', { pending: c.pending })}</p>
<section id="mutations"><h2>${tr('report.mutations')}</h2>
<p>${tr('cli.summary.executed', { planned: c.mutations, executed: c.mutations - c.pending, skipped: c.skipped, pending: c.pending })} ${tr('report.resilience', { rate: r.resilienceRate === null ? '—' : `${String(Math.round(r.resilienceRate * 1000) / 10)} %` })}</p>
<h3>${tr('report.counts')}</h3><div class="cs">${counts}</div></section>
<section id="baseline"><h2>${tr('report.baseline')}</h2>
<p>${tr('report.baseline.summary', { tests: b.tests, passed: b.passed, failing: b.failing.length, flaky: b.flaky.length, calls: b.calls })}</p>
${b.failing.length === 0 ? '' : list('report.baseline.failing', b.failing)}</section>
${coverage}
<section id="capabilities"><h2>${tr('report.capabilities')} — <code>${esc(caps.adapter)}</code></h2>
<p class="mu">${caps.verifiedAt === null ? tr('report.capabilities.neverVerified') : tr('report.capabilities.verifiedAt', { date: caps.verifiedAt })}</p>
<table><thead><tr><th>${tr('report.col.capability')}</th><th>${tr('report.col.declared')}</th><th>${tr('report.col.verified')}</th><th>${tr('report.col.reason')}</th></tr></thead><tbody>${capRows}</tbody></table></section>
<section id="issues"><h2>${tr('report.issues')}</h2>${issues}</section>
<section id="acceptances"><h2>${tr('report.acceptances')}</h2>${acceptances}</section>
<section id="not-covered"><h2>${tr('report.notCovered')}</h2>
${list('dash.notCovered.neverCalled', nc.neverCalled)}${list('dash.notCovered.transitiveOnly', nc.transitiveOnly)}${list('dash.notCovered.unsupported', nc.unsupported)}${list('dash.notCovered.flaky', nc.flakyTests)}${list(
    'report.nc.nonMutable',
    nc.nonMutableInputs.map((i) => `${i.target} ${i.path} (${i.reason})`),
  )}${list(
    'report.nc.skipped',
    nc.skippedMutations.map((m) => `${m.id} (${m.reason})`),
  )}<p>${tr('report.nc.pending', { count: nc.pendingMutations })}</p></section>
<section id="limitations"><h2>${tr('report.limitations')}</h2><ul>${r.limitations.map((l) => `<li>${trOr(`dash.limitation.${l}`, l)}</li>`).join('')}</ul></section>
<section id="reproducibility"><h2>${tr('report.repro')}</h2><p class="mu"><code>seed=${esc(rp.seed ?? '')} config=${esc(rp.configHash)} env=${esc(rp.envHash)} commit=${esc(rp.gitCommit ?? '—')} branch=${esc(rp.gitBranch ?? '—')} varia=${esc(rp.variaVersion)}</code></p></section>
</main>
<footer><span class="by">Varia ${tr('byline')}</span> · <a href="${esc(orqeaUrl)}" target="_top">${tr('poweredBy')}</a> · <a href="${esc(AUTHOR_URL)}" target="_blank" rel="noreferrer noopener">${tr('author')}</a></footer>
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
          ? `<failure type="${xmlAttr(s)}" message="${xmlAttr(m.error ? `${m.error.name}: ${m.error.message}` : s)}">${esc(`varia replay ${m.id}`)}</failure>`
          : m.status === null || m.status === 'SKIPPED'
            ? `<skipped message="${xmlAttr(m.reason ?? 'PENDING')}"/>`
            : ''
        return `    <testcase classname="${xmlAttr(target)}" name="${xmlAttr(`${m.id} ${m.path} ${m.strategy}`)}" time="${((m.durationMs ?? 0) / 1000).toFixed(3)}">${body}</testcase>`
      })
      .join('\n')
    return `  <testsuite name="${xmlAttr(target)}" tests="${String(ms.length)}" failures="${String(failures)}" skipped="${String(skipped)}">\n${cases}\n  </testsuite>`
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

/** Résumé Markdown (commentaire de PR, résumé de job) : partiel, capacités, non couvert, limites. */
export function toMarkdown(r: Report, locale: Locale): string {
  const c = r.counts
  const tr = (k: MessageKey, p: Record<string, string | number> = {}) =>
    t(locale, k, Object.fromEntries(Object.entries(p).map(([a, b]) => [a, String(b)])))
  const trOr = (k: string, raw: string) => (k in messages[locale] ? tr(k as MessageKey) : raw)
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')
  const rows = r.issues.map(
    (i) =>
      `| ${tr(`dash.severity.${i.severity}` as MessageKey)} | ${cell(trOr(`issue.state.${i.state}`, i.state))} | ${cell(issueTitle(locale, i))}${i.transitive ? ` _(${tr('report.transitive')})_` : ''}${i.matchedFrom.length === 0 ? '' : ` _(${tr('report.matchedFrom', { ids: i.matchedFrom.join(', ') })})_`} | ${String(i.count)} | \`${i.replay}\` |`,
  )
  const caps = Object.entries(r.capabilities.verified).map(
    ([k, v]) =>
      `| ${trOr(`report.cap.${k}`, k)} | ${tr(r.capabilities.declared[k] === true ? 'report.yes' : 'report.no')} | ${tr(`report.capStatus.${v.status}`)} | ${v.reason === null ? '' : cell(trOr(`report.capReason.${v.reason}`, v.reason))} |`,
  )
  const nc = r.notCovered
  const ncLine = (k: MessageKey, xs: string[]) =>
    `- ${tr(k)} (${String(xs.length)})${xs.length === 0 ? '' : ` : ${xs.map((x) => `\`${x}\``).join(', ')}`}`
  return [
    `# ${tr('report.title', { project: r.project.name })}${r.run.partial ? ` — **${tr('report.partialLabel')}**` : ''}`,
    '',
    tr('cli.summary.executed', {
      planned: c.mutations,
      executed: c.mutations - c.pending,
      skipped: c.skipped,
      pending: c.pending,
    }),
    '',
    r.run.partial ? tr('report.partial', { pending: c.pending }) : tr('report.complete'),
    '',
    `| ${tr('report.col.severity')} | ${tr('report.col.state')} | ${tr('report.col.issue')} | ${tr('report.col.count')} | ${tr('report.col.replay')} |`,
    '|---|---|---|---|---|',
    ...rows,
    '',
    `## ${tr('report.capabilities')} (${r.capabilities.adapter})`,
    '',
    r.capabilities.verifiedAt === null
      ? tr('report.capabilities.neverVerified')
      : tr('report.capabilities.verifiedAt', { date: r.capabilities.verifiedAt }),
    '',
    `| ${tr('report.col.capability')} | ${tr('report.col.declared')} | ${tr('report.col.verified')} | ${tr('report.col.reason')} |`,
    '|---|---|---|---|',
    ...caps,
    '',
    `## ${tr('report.coverage')}`,
    '',
    tr(`report.coverage.status.${r.baselineCoverage.status}`),
    ...(r.baselineCoverage.files.length === 0
      ? []
      : [
          '',
          `| ${COVERAGE_COLS.map((k) => tr(`report.col.${k}`)).join(' | ')} |`,
          `|${COVERAGE_COLS.map(() => '---|').join('')}`,
          ...r.baselineCoverage.files.map(
            (f) => `| ${cell(f.file)} | ${METRICS.map((k) => pct(locale, f[k])).join(' | ')} |`,
          ),
        ]),
    '',
    `## ${tr('report.notCovered')}`,
    '',
    ncLine('dash.notCovered.neverCalled', nc.neverCalled),
    ncLine('dash.notCovered.transitiveOnly', nc.transitiveOnly),
    ncLine('dash.notCovered.unsupported', nc.unsupported),
    ncLine('dash.notCovered.flaky', nc.flakyTests),
    ncLine(
      'report.nc.nonMutable',
      nc.nonMutableInputs.map((i) => `${i.target} ${i.path}`),
    ),
    ncLine(
      'report.nc.skipped',
      nc.skippedMutations.map((m) => m.id),
    ),
    `- ${tr('report.nc.pending', { count: nc.pendingMutations })}`,
    '',
    `## ${tr('report.limitations')}`,
    '',
    ...r.limitations.map((l) => `- ${trOr(`dash.limitation.${l}`, l)}`),
    '',
    `${tr('poweredBy')} · ${tr('author')}`,
    '',
  ].join('\n')
}
