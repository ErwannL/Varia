// Récupère le projet externe de l'acceptation J1 (CDC A.7) à un commit ÉPINGLÉ, dans examples/external/
// (ignoré par git, jamais committé). Réseau utilisé au DÉVELOPPEMENT seulement.
// Usage : node scripts/fetch-external.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const EXTERNAL = {
  name: 'immutability-helper',
  repo: 'https://github.com/kolodny/immutability-helper',
  commit: '3dc903960b8411da84704052d511c20648c45ead',
  license: 'MIT',
}

const dir = join('examples', 'external', EXTERNAL.name)
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'inherit' })
if (!existsSync(join(dir, '.git'))) {
  mkdirSync(dir, { recursive: true })
  git('init', '-q')
  git('remote', 'add', 'origin', EXTERNAL.repo)
}
git('fetch', '-q', '--depth', '1', 'origin', EXTERNAL.commit)
git('-c', 'advice.detachedHead=false', 'checkout', '-q', '--force', EXTERNAL.commit)
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
if (head !== EXTERNAL.commit) throw new Error(`commit inattendu : ${head}`)
execFileSync('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts'], {
  cwd: dir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
console.log(`${EXTERNAL.name} prêt à ${head} dans ${dir}`)
