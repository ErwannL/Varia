// Installe les dépendances (lockfile, `npm ci`) des projets d'exemple utilisés par les tests.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

for (const dir of readdirSync('examples', { withFileTypes: true })) {
  const root = join('examples', dir.name)
  if (!dir.isDirectory() || dir.name === 'external' || !existsSync(join(root, 'package-lock.json')))
    continue
  console.log(`npm ci dans ${root}`)
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
}
