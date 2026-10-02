// A-06 : test.env, reset.database (commande avant chaque mutation) et reset.filesystem (tmpdir) avec un
// vrai runner (Jest) ; le projet cible n'est jamais modifié.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { json, newDataDir, varia } from '../j1/helpers.js'

const LIMITS = resolve('examples/limits-project')

function projectWithEnvTarget(): string {
  const d = mkdtempSync(join(tmpdir(), 'varia-reset-'))
  cpSync(join(LIMITS, 'package.json'), join(d, 'package.json'))
  symlinkSync(join(LIMITS, 'node_modules'), join(d, 'node_modules'), 'dir')
  mkdirSync(join(d, 'src'))
  mkdirSync(join(d, 'tests'))
  writeFileSync(
    join(d, 'src', 'env.js'),
    [
      "const fs = require('fs')",
      "const path = require('path')",
      'function greeting(key) { return process.env[key] ?? null }',
      // Écrit dans le répertoire temporaire du processus (os.tmpdir suit TMPDIR, TMP, TEMP : reset.filesystem).
      "function scratch(name) { const f = path.join(require('os').tmpdir(), String(name)); fs.writeFileSync(f, 'x'); return f }",
      'module.exports = { greeting, scratch }',
    ].join('\n'),
  )
  writeFileSync(
    join(d, 'tests', 'env.test.js'),
    [
      "const { greeting, scratch } = require('../src/env')",
      "test('test.env atteint le processus de test', () => { expect(greeting('GREETING')).toBe('bonjour') })",
      "test('scratch', () => { expect(scratch('a')).toContain('a') })",
    ].join('\n'),
  )
  return d
}

describe('reset et environnement de test (A-06)', () => {
  it('test.env appliqué, commande de reset avant chaque mutation, répertoire jetable par mutation', async () => {
    const d = projectWithEnvTarget()
    const log = join(mkdtempSync(join(tmpdir(), 'varia-log-')), 'reset.log')
    const cfg = join(mkdtempSync(join(tmpdir(), 'varia-cfg-')), 'varia.yml')
    writeFileSync(
      cfg,
      [
        'version: 1',
        'test: { env: { GREETING: bonjour } }',
        "mutations: { seed: 1, per_input: 2, strategies: ['type'] }",
        `execution: { timeout_ms: 20000, reset: { database: command, database_command: 'echo reset >> ${log}', filesystem: tmpdir } }`,
      ].join('\n'),
    )
    const r = await varia(['--data-dir', newDataDir(), '--config', cfg, '--json', 'test'], d)
    expect([0, 1], r.err).toContain(r.code)
    const report = json<{ counts: { mutations: number; infra: number; pending: number } }>(r)
    expect(report.counts.mutations).toBeGreaterThan(0)
    expect([report.counts.infra, report.counts.pending]).toEqual([0, 0])
    // Une ligne de reset par mutation exécutée.
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(report.counts.mutations)
  })
})
