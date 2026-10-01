// Récupère les projets externes (scripts/external-projects.mjs) à leur commit ÉPINGLÉ, dans
// examples/external/ (ignoré par git, jamais committé). Réseau utilisé au DÉVELOPPEMENT seulement.
// Usage : node scripts/fetch-external.mjs [nom…]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { EXTERNAL_PROJECTS } from './external-projects.mjs'

const wanted = process.argv.slice(2)
for (const p of EXTERNAL_PROJECTS.filter((x) => wanted.length === 0 || wanted.includes(x.name))) {
  const dir = join('examples', 'external', p.name)
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'inherit' })
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dir, { recursive: true })
    git('init', '-q')
    git('remote', 'add', 'origin', p.repo)
  }
  git('fetch', '-q', '--depth', '1', 'origin', p.commit)
  git('-c', 'advice.detachedHead=false', 'checkout', '-q', '--force', p.commit)
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  if (head !== p.commit) throw new Error(`${p.name} : commit inattendu ${head}`)
  execFileSync('npm', p.install, {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  console.log(`${p.name} prêt à ${head} dans ${dir}`)
}
