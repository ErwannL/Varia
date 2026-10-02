// Fournisseur de couverture de Varia pour Vitest (politique J3, docs/notes/couverture.md) : celui de
// Vitest (v8), plus une copie de la couverture V8 BRUTE des fichiers `packages/**/runtime/**`.
// Raison : ces fichiers sont chargés par le `require`/`import` natif de Node (jamais par Vite), et Vitest
// les convertit avec la source TRANSFORMÉE par Vite, dont les positions ne correspondent pas à celles
// de V8 (constaté : branches « sinon » à 0 alors qu'exécutées). scripts/coverage.mjs les reconvertit
// depuis la source réelle, comme la couverture des processus enfants.
import v8 from '@vitest/coverage-v8'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let seq = 0

/** @typedef {{ url: string, functions: unknown[], startOffset?: number }} RawEntry */

/**
 * Garde les entrées des fichiers d'exécution ; refuse un fichier d'exécution chargé par Vite.
 * @param {RawEntry[]} result @returns {RawEntry[]}
 */
export function runtimeEntries(result) {
  return result.filter((r) => {
    if (!r.url.startsWith('file://')) return false
    const file = fileURLToPath(r.url).split('\\').join('/')
    if (!/\/packages\/(?:[^/]+\/)+runtime\//.test(file) || file.includes('/node_modules/'))
      return false
    if ((r.startOffset ?? 0) !== 0)
      throw new Error(`${file} chargé par Vite dans un test : le charger par require/import natif`)
    return true
  })
}

export default {
  ...v8,
  async getProvider() {
    const provider = await v8.getProvider()
    const original = provider.onAfterSuiteRun.bind(provider)
    provider.onAfterSuiteRun = (/** @type {any} */ meta) => {
      const dir = process.env['VARIA_CHILD_COVERAGE']
      if (dir) {
        const result = runtimeEntries(meta.coverage?.result ?? [])
        if (result.length > 0) {
          mkdirSync(dir, { recursive: true })
          const name = `kept-inproc-${process.pid}-${seq++}.json`
          writeFileSync(join(dir, name), JSON.stringify({ result }))
        }
      }
      return original(meta)
    }
    return provider
  },
}
