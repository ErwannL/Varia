// J4 T-02 : `varia scaffold adapter|strategy|rule|reporter <nom>`. Pour CHAQUE type, le squelette
// généré (dossier temporaire) est conforme à Prettier, compile (tsc --noEmit, strict) et ses tests
// passent (vitest run) — dont la suite de conformité d'adaptateur, telle quelle. Les paquets @varia/*
// sont résolus vers les sources du dépôt par une configuration temporaire (paths / alias) posée À CÔTÉ
// du squelette, jamais dedans. Plus : déterminisme (mêmes octets) et refus (code 3, message i18n).
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli, type Io } from '../../packages/cli/src/index.js'
import { scaffoldFiles, SCAFFOLD_KINDS } from '../../packages/cli/src/scaffold/index.js'

const REPO = resolve('.')
const NODE_MODULES = join(REPO, 'node_modules')

async function cli(argv: string[], cwd: string, lang = 'fr_FR.UTF-8') {
  const out: string[] = []
  const err: string[] = []
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l) }
  const code = await runCli(argv, io, { env: { LANG: lang }, cwd })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

/** Contenu d'un dossier (chemins relatifs POSIX → octets), liens symboliques exclus. */
function tree(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) Object.assign(out, tree(p, base))
    else if (e.isFile()) out[relative(base, p).split('\\').join('/')] = readFileSync(p, 'latin1')
  }
  return out
}

const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix))

// Résolution des @varia/* vers les sources du dépôt (mêmes règles que tsconfig.json / vitest.config).
const ALIASES = `[
  { find: /^@varia\\/adapter-(?!conformance$)([\\w-]+)$/, replacement: ${JSON.stringify(REPO)} + '/packages/adapters/$1/src/index.ts' },
  { find: /^@varia\\/([\\w-]+)$/, replacement: ${JSON.stringify(REPO)} + '/packages/$1/src/index.ts' },
]`

function env(): NodeJS.ProcessEnv {
  const kept = Object.entries(process.env).filter(
    ([k]) => !k.startsWith('VITEST') && k !== 'TEST' && k !== 'FORCE_COLOR',
  )
  return { ...Object.fromEntries(kept), NO_COLOR: '1' }
}

// Asynchrone : un appel synchrone de plusieurs dizaines de secondes bloquerait le fil du worker vitest
// (« Timeout calling onTaskUpdate » sous charge).
const node = async (args: string[], cwd: string): Promise<string> =>
  (
    await promisify(execFile)(process.execPath, args, {
      cwd,
      env: env(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  ).stdout

/**
 * Prouve le squelette `<parent>/<name>` : Prettier, tsc --noEmit, vitest run. Le dossier parent
 * (temporaire) reçoit le lien `node_modules` du dépôt et les configurations de résolution.
 */
async function prove(parent: string, name: string): Promise<string> {
  const skel = join(parent, name)
  symlinkSync(NODE_MODULES, join(parent, 'node_modules'), 'junction')
  const paths = {
    '@varia/adapter-*': [join(REPO, 'packages/adapters/*/src/index.ts')],
    '@varia/adapter-conformance': [join(REPO, 'packages/adapter-conformance/src/index.ts')],
    '@varia/*': [join(REPO, 'packages/*/src/index.ts')],
  }
  writeFileSync(
    join(parent, 'tsconfig.varia.json'),
    JSON.stringify({ extends: `./${name}/tsconfig.json`, compilerOptions: { paths } }),
  )
  writeFileSync(
    join(parent, 'vitest.varia.config.ts'),
    `import { mergeConfig } from 'vitest/config'
import base from './${name}/vitest.config.ts'
export default mergeConfig(base, { root: ${JSON.stringify(skel)}, resolve: { alias: ${ALIASES} } })
`,
  )
  await node([join(NODE_MODULES, 'prettier/bin/prettier.cjs'), '--check', '.'], skel)
  await node(
    [join(NODE_MODULES, 'typescript/bin/tsc'), '-p', join(parent, 'tsconfig.varia.json')],
    skel,
  )
  return await node(
    [
      join(NODE_MODULES, 'vitest/vitest.mjs'),
      'run',
      '--config',
      join(parent, 'vitest.varia.config.ts'),
      '--reporter',
      'verbose',
    ],
    skel,
  )
}

describe('varia scaffold : chaque squelette compile et ses tests passent', () => {
  it('strategy : extension chargée par le testkit, RNG semé, déterministe', async () => {
    const parent = tmp('varia-scaffold-')
    const r = await cli(['scaffold', 'strategy', 'casse-tete', '--dir', parent], REPO)
    expect(r.code).toBe(0)
    expect(r.out).toContain(`Squelette strategy créé : ${join(parent, 'casse-tete')} (10 fichiers)`)
    const out = await prove(parent, 'casse-tete')
    expect(out).toMatch(/Tests\s+2 passed \(2\)/)
  })

  it('rule : règle d’oracle évaluée par le testkit', async () => {
    const parent = tmp('varia-scaffold-')
    expect((await cli(['scaffold', 'rule', 'codes', '--dir', parent], REPO)).code).toBe(0)
    expect(await prove(parent, 'codes')).toMatch(/Tests\s+2 passed \(2\)/)
  })

  it('reporter : rapporteur rendu par le testkit', async () => {
    const parent = tmp('varia-scaffold-')
    // Sans --dir : dossier courant.
    expect((await cli(['scaffold', 'reporter', 'resume'], parent)).code).toBe(0)
    expect(await prove(parent, 'resume')).toMatch(/Tests\s+2 passed \(2\)/)
  })

  it('adapter : contrat TestAdapter, test unitaire et suite de conformité passés tels quels', async () => {
    const parent = tmp('varia-scaffold-')
    const name = 'mon-lanceur-de-tests-maison-xy' // 30 caractères : longueur maximale
    expect((await cli(['scaffold', 'adapter', name, '--dir', parent], REPO)).code).toBe(0)
    const skel = join(parent, name)
    expect(readFileSync(join(skel, 'src/index.ts'), 'utf8')).toContain(
      'export class MonLanceurDeTestsMaisonXyAdapter implements TestAdapter',
    )
    symlinkSync(NODE_MODULES, join(skel, 'example/node_modules'), 'junction')
    const out = await prove(parent, name)
    expect(out).toContain('passe toutes les vérifications')
    expect(out).toMatch(/Tests\s+3 passed \(3\)/)
  })
})

describe('varia scaffold : déterminisme', () => {
  it('même type et même nom ⇒ mêmes fichiers, mêmes octets, sans date ni chemin', async () => {
    for (const kind of SCAFFOLD_KINDS) {
      const a = tmp('varia-scaffold-a-')
      const b = tmp('varia-scaffold-b-')
      expect((await cli(['scaffold', kind, 'demo', '--dir', a], REPO)).code).toBe(0)
      expect((await cli(['scaffold', kind, 'demo', '--dir', b], REPO, 'en_US')).code).toBe(0)
      const ta = tree(join(a, 'demo'))
      expect(tree(join(b, 'demo'))).toEqual(ta)
      expect(ta).toEqual(
        Object.fromEntries(
          Object.entries(scaffoldFiles(kind, 'demo')).map(([k, v]) => [
            k,
            Buffer.from(v).toString('latin1'),
          ]),
        ),
      )
      const all = Object.values(ta).join('\n')
      expect(all).not.toMatch(/20\d\d-\d\d-\d\d/)
      expect(all).not.toContain(a)
      expect(all).not.toContain(REPO)
    }
  })

  it('nom de longueur maximale : chaque squelette reste conforme à Prettier', async () => {
    const parent = tmp('varia-scaffold-')
    for (const kind of SCAFFOLD_KINDS) {
      const name = `${kind}-${'x'.repeat(29 - kind.length)}`
      expect(name).toHaveLength(30)
      expect((await cli(['scaffold', kind, name, '--dir', parent], REPO)).code).toBe(0)
    }
    await node([join(NODE_MODULES, 'prettier/bin/prettier.cjs'), '--check', '.'], parent)
  })

  it('les fichiers sont triés et les gabarits dépendent du nom', () => {
    const files = Object.keys(scaffoldFiles('rule', 'x'))
    expect(files).toEqual([...files].sort())
    expect(scaffoldFiles('rule', 'x')).not.toEqual(scaffoldFiles('rule', 'y'))
  })

  it('--json : type, chemin et fichiers', async () => {
    const parent = tmp('varia-scaffold-')
    const r = await cli(['--json', 'scaffold', 'reporter', 'r', '--dir', parent], REPO)
    expect(r.code).toBe(0)
    const data = JSON.parse(r.out) as { kind: string; path: string; files: string[] }
    expect(data.kind).toBe('reporter')
    expect(data.path).toBe(join(parent, 'r'))
    expect(data.files).toContain('src/index.mjs')
  })
})

describe('varia scaffold : refus (code 3, message traduit, rien d’écrit)', () => {
  it('type inconnu', async () => {
    const parent = tmp('varia-scaffold-')
    const fr = await cli(['scaffold', 'widget', 'x', '--dir', parent], REPO)
    expect(fr.code).toBe(3)
    expect(fr.err).toContain(
      'Type de squelette inconnu : widget (attendu : adapter, strategy, rule, reporter)',
    )
    const en = await cli(['scaffold', 'widget', 'x', '--dir', parent], REPO, 'en_US')
    expect(en.err).toContain('Unknown skeleton type: widget')
    expect(readdirSync(parent)).toEqual([])
  })

  it('nom invalide : majuscules, tiret initial ou double, espace, trop long', async () => {
    const parent = tmp('varia-scaffold-')
    for (const name of ['Mon', '_a', 'a--b', 'a b', 'a-', '1a', 'a'.repeat(31), '../x']) {
      const r = await cli(['scaffold', 'adapter', name, '--dir', parent], REPO)
      expect(r.code, name).toBe(3)
      expect(r.err).toContain(`Nom invalide : « ${name} »`)
      expect(r.err).toContain('30 caractères au plus')
    }
    const en = await cli(['scaffold', 'rule', 'Mon', '--dir', parent], REPO, 'en_US')
    expect(en.err).toContain('Invalid name: "Mon"')
    expect(readdirSync(parent)).toEqual([])
  })

  it('dossier cible non vide : refusé ; vide : accepté', async () => {
    const parent = tmp('varia-scaffold-')
    mkdirSync(join(parent, 'pris'))
    writeFileSync(join(parent, 'pris', 'a.txt'), 'garde')
    const r = await cli(['scaffold', 'strategy', 'pris', '--dir', parent], REPO)
    expect(r.code).toBe(3)
    expect(r.err).toContain(`Le dossier cible existe et n'est pas vide : ${join(parent, 'pris')}`)
    const en = await cli(['scaffold', 'strategy', 'pris', '--dir', parent], REPO, 'en_US')
    expect(en.err).toContain('The target directory exists and is not empty')
    expect(readdirSync(join(parent, 'pris'))).toEqual(['a.txt'])
    mkdirSync(join(parent, 'vide'))
    expect((await cli(['scaffold', 'strategy', 'vide', '--dir', parent], REPO)).code).toBe(0)
    expect(statSync(join(parent, 'vide', 'src', 'index.mjs')).isFile()).toBe(true)
  })

  it('cible qui est un fichier : refusée', async () => {
    const parent = tmp('varia-scaffold-')
    writeFileSync(join(parent, 'f'), 'x')
    const r = await cli(['scaffold', 'rule', 'f', '--dir', parent], REPO)
    expect(r.code).toBe(3)
    expect(r.err).toContain(`La cible existe et n'est pas un dossier : ${join(parent, 'f')}`)
    const en = await cli(['scaffold', 'rule', 'f', '--dir', parent], REPO, 'en_US')
    expect(en.err).toContain('The target exists and is not a directory')
    expect(readFileSync(join(parent, 'f'), 'utf8')).toBe('x')
  })

  it('aide : la commande est listée et décrite', async () => {
    const r = await cli(['--help'], REPO)
    expect(r.out).toContain('scaffold')
    expect(r.out).toContain('squelette fonctionnel')
  })
})
