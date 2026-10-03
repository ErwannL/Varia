// Adapter PHPUnit (R-03) : fonctions pures et exécutions réelles de PHPUnit (examples/phpunit-project).
import {
  exactFilter,
  installedPhpunit,
  parseResults,
  PHPUNIT_CAPABILITIES,
  PhpunitAdapter,
  projectBootstrap,
} from '@varia/adapter-phpunit'
import type { PrepareContext } from '@varia/core'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const EXAMPLE = resolve('examples/phpunit-project')
const tmp = (p = 'varia-phpunit-') => mkdtempSync(join(tmpdir(), p))

function ctx(root: string, extra: Partial<PrepareContext> = {}): PrepareContext {
  return {
    root,
    tmpDir: tmp(),
    runId: 'r_test',
    include: ['src/**'],
    exclude: [],
    redact: { fields: ['password'], patterns: [], skipPaths: [], hmacKey: 'k' },
    ...extra,
  }
}

describe('fonctions pures', () => {
  it('bootstrap du projet : attribut de la configuration (relatif ou absolu), sinon vendor/autoload.php', () => {
    const d = tmp()
    expect(projectBootstrap(d)).toBeNull()
    mkdirSync(join(d, 'vendor'))
    writeFileSync(join(d, 'vendor', 'autoload.php'), '<?php')
    writeFileSync(join(d, 'phpunit.xml.dist'), '<phpunit colors="false"></phpunit>')
    expect(projectBootstrap(d)).toBe(join(d, 'vendor', 'autoload.php'))
    writeFileSync(join(d, 'phpunit.dist.xml'), '<phpunit\n  bootstrap="tests/boot.php">')
    expect(projectBootstrap(d)).toBe(join(d, 'tests', 'boot.php'))
    writeFileSync(join(d, 'phpunit.xml'), '<phpunit bootstrap="/abs/boot.php">')
    expect(projectBootstrap(d)).toBe('/abs/boot.php')
  })

  it('version installée lue dans vendor/composer/installed.json', () => {
    const d = tmp()
    expect(installedPhpunit(d)).toBeNull()
    mkdirSync(join(d, 'vendor', 'composer'), { recursive: true })
    const f = join(d, 'vendor', 'composer', 'installed.json')
    writeFileSync(f, '{}')
    expect(installedPhpunit(d)).toBeNull()
    writeFileSync(
      f,
      JSON.stringify({ packages: [{ name: 'phpunit/phpunit', version: 'v11.5.2' }] }),
    )
    expect(installedPhpunit(d)).toBe('11.5.2')
    expect(installedPhpunit(EXAMPLE)).toBe('11.5.2')
  })

  it('résultats : identités de la sonde, homonymes rangés, statut inconnu ⇒ other, JSON invalide ⇒ null', () => {
    expect(parseResults('{', '/p')).toBeNull()
    const rows = parseResults(
      JSON.stringify([
        { file: '/p/tests/ATest.php', name: 'a', status: 'passed', durationMs: 1 },
        { file: '/p/tests/ATest.php', name: 'a', status: 'failed', durationMs: 2 },
        { file: '/p/tests/ATest.php', name: 'b', status: 'skipped', durationMs: 3 },
        { file: '/p/tests/ATest.php', name: 'c', status: 'risky', durationMs: 4 },
      ]),
      '/p',
    )
    expect(rows?.map((r) => [r.file, r.status])).toEqual([
      ['tests/ATest.php', 'passed'],
      ['tests/ATest.php', 'failed'],
      ['tests/ATest.php', 'skipped'],
      ['tests/ATest.php', 'other'],
    ])
    expect(rows?.[0]?.testId).not.toBe(rows?.[1]?.testId)
  })

  it('filtre exact : seuls les tests de ce fichier et de ce nom ; aucun ⇒ motif vide', () => {
    const list = [
      { file: '/p/tests/A.php', name: 'n', filter: 'A\\:\\:t1' },
      { file: '/p/tests/A.php', name: 'n', filter: 'A\\:\\:t2' },
      { file: '/p/tests/B.php', name: 'n', filter: 'B\\:\\:t' },
    ]
    expect(exactFilter(list, '/p', 'tests/A.php', 'n')).toBe('/^(?:A\\:\\:t1|A\\:\\:t2)$/')
    expect(exactFilter(list, '/p', 'tests/A.php', 'autre')).toBe('/(?!)/')
  })
})

describe('PhpunitAdapter', () => {
  it('capacités déclarées (copie), détection', async () => {
    const a = new PhpunitAdapter()
    expect(a.capabilities()).toEqual(PHPUNIT_CAPABILITIES)
    expect(a.capabilities()).not.toBe(PHPUNIT_CAPABILITIES)
    expect(await a.detect(EXAMPLE)).toEqual({
      detected: true,
      framework: 'phpunit',
      version: '11.5.2',
      nativeEsm: false,
      reasons: [],
    })
    expect((await a.detect(tmp())).reasons).toEqual(['RUNNER_NOT_FOUND'])
    await expect(a.run({ mode: 'observe', runDir: tmp(), timeoutMs: 1000 })).rejects.toThrow(
      'prepare',
    )
  })

  it('observation de tout le projet : tests, appels, aucun fichier écrit dans le projet', async () => {
    const a = new PhpunitAdapter()
    const c = ctx(EXAMPLE, { env: { VARIA_MODE: 'ignoré' } })
    await a.prepare(c)
    expect(JSON.parse(readFileSync(join(c.tmpDir, 'targets.json'), 'utf8'))).toMatchObject({
      include: ['^src/.*$'],
    })
    const runDir = tmp()
    // Variables VARIA_* héritées (run Varia englobant) : jamais transmises telles quelles.
    process.env['VARIA_PLAN'] = '/plan/hérité.json'
    const r = await a.run({ mode: 'observe', runDir, timeoutMs: 60_000, maxOutputBytes: 1 << 20 })
    Reflect.deleteProperty(process.env, 'VARIA_PLAN')
    expect(r.process.exitCode, r.process.stdout).toBe(0)
    expect(r.tests).toHaveLength(11)
    expect(r.events.some((e) => e.type === 'OBSERVE_CALL' && e.export === 'createUser')).toBe(true)
    expect([r.truncatedLines, r.invalidLines]).toEqual([0, 0])
  })

  it('sélection d’un test par fichier et nom (liste mise en cache), fuzz avec plan', async () => {
    const a = new PhpunitAdapter({ php: 'php' })
    await a.prepare(ctx(EXAMPLE))
    const one = async (name: string) =>
      a.run({
        mode: 'fuzz',
        runDir: tmp(),
        timeoutMs: 60_000,
        testFile: 'tests/ValuesTest.php',
        testName: name,
        planPath: join(tmp(), 'absent.json'),
        mutationId: 'm_x',
        env: { X: '1' },
      })
    const r = await one('echoValue renvoie sa valeur')
    expect(r.tests?.map((t) => t.name)).toEqual(['echoValue renvoie sa valeur'])
    expect((await one('inexistant')).tests).toEqual([])
    // Fichier seul : tous ses tests.
    const f = await a.run({
      mode: 'observe',
      runDir: tmp(),
      timeoutMs: 60_000,
      testFile: 'tests/UsersTest.php',
    })
    expect(f.tests).toHaveLength(5)
    expect(await a.listTests(1)).toHaveLength(11)
  })

  it('projet sans configuration ni bootstrap, liste impossible, délai dépassé ⇒ aucun résultat', async () => {
    const root = tmp()
    symlinkSync(join(EXAMPLE, 'vendor', 'phpunit'), join(root, 'vendor-phpunit'))
    mkdirSync(join(root, 'vendor', 'phpunit'), { recursive: true })
    symlinkSync(
      join(EXAMPLE, 'vendor', 'phpunit', 'phpunit'),
      join(root, 'vendor', 'phpunit', 'phpunit'),
    )
    const a = new PhpunitAdapter()
    await a.prepare(ctx(root, { cwd: root }))
    expect(await a.listTests(60_000)).toEqual([])
    const r = await a.run({ mode: 'observe', runDir: tmp(), timeoutMs: 1 })
    expect(r.tests).toBeNull()
    // Interpréteur introuvable : aucune liste écrite, aucun test sélectionnable.
    const b = new PhpunitAdapter({ php: join(root, 'php-absent') })
    await b.prepare(ctx(root))
    expect(await b.listTests(60_000)).toEqual([])
  })
})
