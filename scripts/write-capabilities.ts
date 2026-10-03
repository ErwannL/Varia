// Matrice de compatibilité MESURÉE (S-01) : pour chaque adaptateur de `varia list adapters`, lance le
// VRAI `doctor` du moteur sur son projet d'exemple (examples/<id>-project) et écrit
// docs/adapter-capabilities.md — jamais écrit à la main. Le projet d'exemple n'est jamais modifié :
// `doctor` le vérifie lui-même (guardProject, échec si un fichier change) et range ses données dans un
// dossier temporaire hors du projet, supprimé ensuite.
//
// Usage : npm run capabilities (écrit) | npm run capabilities:check (compare, n'écrit rien).
// Un adaptateur non mesuré (outil du langage absent, lanceur introuvable, erreur) est écrit comme tel
// (« non mesuré »), jamais avec des valeurs inventées, et fait ÉCHOUER les deux commandes (exit 1).
import { doctor, EngineContext, type DoctorReport } from '@varia/engine'
import { messages, t, type MessageKey } from '@varia/i18n'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { format } from 'prettier'
import { ADAPTERS } from '../packages/cli/src/commands/admin.js'
import { adapterFor } from '../packages/cli/src/shared.js'

export const DOC = 'docs/adapter-capabilities.md'

export interface Capability {
  name: string
  declared: boolean
  status: string
  reason: string | null
}

/** Résultat d'un adaptateur : mesuré (doctor a lancé le lanceur) ou non, avec la raison. */
export type Row =
  | {
      adapter: string
      example: string
      measured: true
      version: string | null
      verdict: string
      reasons: string[]
      caps: Capability[]
    }
  | { adapter: string; example: string; measured: false; why: string }

export const exampleOf = (id: string): string => `examples/${id}-project`

/** Ligne d'un rapport de doctor ; lanceur introuvable ⇒ non mesuré (rien n'a été exécuté). */
export function rowOf(adapter: string, example: string, r: DoctorReport): Row {
  if (r.verdict === 'RUNNER_NOT_FOUND')
    return { adapter, example, measured: false, why: 'RUNNER_NOT_FOUND' }
  const caps = Object.keys(r.checks).map((name) => {
    const k = name as keyof DoctorReport['checks']
    return {
      name,
      declared: r.declared[k],
      status: r.checks[k].status,
      reason: r.checks[k].reason,
    }
  })
  const reasons = [...new Set(r.reasons)].sort()
  return {
    adapter,
    example,
    measured: true,
    version: r.adapterVersion,
    verdict: r.verdict,
    reasons,
    caps,
  }
}

/** Lance le vrai doctor sur le projet d'exemple de l'adaptateur `id`. */
export async function measure(id: string): Promise<Row> {
  const example = exampleOf(id)
  const dataDir = mkdtempSync(join(tmpdir(), 'varia-capabilities-'))
  try {
    const adapter = adapterFor(resolve(example))
    if (adapter.id !== id)
      return { adapter: id, example, measured: false, why: `ADAPTER_MISMATCH:${adapter.id}` }
    const ctx = new EngineContext({ root: resolve(example), adapter, dataDir })
    try {
      return rowOf(id, example, await doctor(ctx))
    } finally {
      ctx.close()
    }
  } catch (e) {
    const code = (e as { code?: unknown }).code
    return {
      adapter: id,
      example,
      measured: false,
      why: `ERROR:${typeof code === 'string' ? code : 'UNKNOWN'}`,
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
}

/** Libellé français d'un code de raison ; code inconnu des traductions ⇒ le code lui-même. */
const fr = (key: string, fallback: string): string =>
  key in messages.fr ? t('fr', key as MessageKey) : fallback

const WHY: Record<string, string> = {
  RUNNER_NOT_FOUND: 'outil absent (lanceur introuvable : langage ou dépendances non installés)',
}
const whyText = (why: string): string => WHY[why] ?? why

/** Markdown de la matrice : déterministe (ordre de ADAPTERS, capacités triées, ni date ni durée). */
export function render(rows: Row[]): string {
  const measured = rows.filter((r) => r.measured)
  const names = [...new Set(measured.flatMap((r) => r.caps.map((c) => c.name)))].sort()
  const codes = [
    ...new Set(
      measured.flatMap((r) => r.caps.flatMap((c) => (c.reason === null ? [] : [c.reason]))),
    ),
  ].sort()
  const cell = (r: Row, name: string): string => {
    if (!r.measured) return 'non mesuré'
    const c = r.caps.find((x) => x.name === name)
    if (c === undefined) return '—'
    return `${c.declared ? 'oui' : 'non'} / ${c.status}${c.reason === null ? '' : ` (${c.reason})`}`
  }
  const lines = [
    '<!-- Généré par `npm run capabilities` (scripts/write-capabilities.ts) — NE PAS ÉDITER. -->',
    '',
    '# Capacités des adaptateurs (matrice mesurée)',
    '',
    'Matrice **générée** en lançant le vrai `varia doctor` (moteur) sur le projet d’exemple de chaque',
    'adaptateur : une baseline observée et une mutation réellement appliquée. Chaque cellule donne',
    '« déclarée / vérifiée (raison) ». Statuts : `VERIFIED`, `NOT_VERIFIED`, `UNSUPPORTED`. Un adaptateur',
    'dont l’outil est absent est marqué **non mesuré** : aucune valeur n’est alors affirmée.',
    '`npm run capabilities:check` (et `tests/j4/capabilities.test.ts`) échoue si ce fichier diverge de la',
    'mesure ou si un adaptateur n’a pas pu être mesuré.',
    '',
    '## Adaptateurs',
    '',
    '| Adaptateur | Projet d’exemple | Lanceur (version) | Verdict | Constats |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((r) =>
      r.measured
        ? `| ${r.adapter} | \`${r.example}\` | ${r.version ?? '?'} | ${r.verdict} | ${r.reasons.join(', ') || '—'} |`
        : `| ${r.adapter} | \`${r.example}\` | — | **non mesuré : ${whyText(r.why)}** | — |`,
    ),
    '',
    '## Capacités (déclarée / vérifiée)',
    '',
    `| Capacité | ${rows.map((r) => r.adapter).join(' | ')} |`,
    `| --- | ${rows.map(() => '---').join(' | ')} |`,
    ...names.map((n) => `| ${n} | ${rows.map((r) => cell(r, n)).join(' | ')} |`),
    '',
    '## Raisons',
    '',
    '| Code | Signification |',
    '| --- | --- |',
    ...codes.map((c) => `| \`${c}\` | ${fr(`report.capReason.${c}`, c)} |`),
    '',
  ]
  return lines.join('\n')
}

/** Markdown mis en forme par Prettier (épinglé), comme le reste du dépôt. */
export const formatDoc = (md: string): Promise<string> => format(md, { parser: 'markdown' })

/**
 * Écrit (ou compare, `check`) la matrice ; renvoie le code de sortie : 1 si un adaptateur n'est pas
 * mesuré ou, en mode `check`, si le fichier diffère. Les messages vont à `log`.
 */
export async function run(
  rows: Row[],
  o: { check: boolean; file: string; log: (l: string) => void },
): Promise<number> {
  const doc = await formatDoc(render(rows))
  let code = 0
  for (const r of rows)
    if (!r.measured) {
      o.log(`non mesuré : ${r.adapter} (${r.why})`)
      code = 1
    }
  if (o.check) {
    let cur = ''
    try {
      cur = readFileSync(o.file, 'utf8')
    } catch {
      cur = ''
    }
    if (cur !== doc) {
      o.log(`${o.file} diverge de la matrice mesurée : lancer npm run capabilities`)
      code = 1
    }
  } else {
    writeFileSync(o.file, doc)
    o.log(`écrit : ${o.file}`)
  }
  return code
}

/** Mesure tous les adaptateurs, séquentiellement (un doctor à la fois). */
export async function measureAll(): Promise<Row[]> {
  const rows: Row[] = []
  for (const id of ADAPTERS) rows.push(await measure(id))
  return rows
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const check = process.argv.includes('--check')
  process.exitCode = await run(await measureAll(), { check, file: DOC, log: (l) => console.log(l) })
}
