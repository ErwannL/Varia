// Supprime les sorties de compilation (dist/, y compris tsbuildinfo) de tous les paquets.
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

for (const root of ['packages', join('packages', 'adapters')]) {
  for (const d of readdirSync(root)) {
    const dist = join(root, d, 'dist')
    if (existsSync(dist)) rmSync(dist, { recursive: true, force: true })
  }
}
