// J2 : cache opt-in (CDC §30) — réutilisation seulement si TOUT est identique ; sinon CACHE_MISS.
import { appendFileSync, cpSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXAMPLE, json, newDataDir, varia } from './helpers.js'

interface R {
  cache: { hits: number; misses: number } | null
  mutations: { id: string; status: string | null }[]
}

describe('cache de résultats', () => {
  it('second run identique : tout vient du cache ; un fichier modifié : tout est réexécuté ; --no-cache', async () => {
    const d = mkdtempSync(join(tmpdir(), 'varia-cache-'))
    for (const f of ['src', 'tests', 'package.json'])
      cpSync(join(EXAMPLE, f), join(d, f), { recursive: true })
    symlinkSync(join(EXAMPLE, 'node_modules'), join(d, 'node_modules'), 'dir')
    cpSync(join(EXAMPLE, 'varia.yml'), join(d, 'varia.yml'))
    appendFileSync(
      join(d, 'varia.yml'),
      'cache: { enabled: true }\nintegrity: { ignore_for_integrity: [] }\n',
    )
    const D = newDataDir()
    const run = async (...extra: string[]) =>
      json<R>(
        await varia(
          [
            '--data-dir',
            D,
            '--json',
            'test',
            '--quick',
            '--seed',
            '4',
            '--max-mutations',
            '12',
            ...extra,
          ],
          d,
        ),
      )
    const first = await run()
    expect(first.cache).toMatchObject({ hits: 0, misses: 12 })
    const second = await run()
    expect(second.cache).toMatchObject({ hits: 12, misses: 0 })
    expect(second.mutations.map((m) => [m.id, m.status])).toEqual(
      first.mutations.map((m) => [m.id, m.status]),
    )
    expect((await run('--no-cache')).cache).toBeNull()
    appendFileSync(join(d, 'src', 'math.js'), '\n// changement sans effet\n')
    expect((await run()).cache).toMatchObject({ hits: 0, misses: 12 })
  })
})
