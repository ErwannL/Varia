import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export type Snapshot = Map<string, string>

const hashFile = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')

/** Avec git (CDC §5) : `git status --porcelain=v1 -z` du projet + empreinte de chaque fichier listé. */
export function gitSnapshot(root: string): Snapshot {
  const out = execFileSync('git', ['status', '--porcelain=v1', '-z', '--', '.'], {
    cwd: root,
    encoding: 'utf8',
  })
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  const snap: Snapshot = new Map()
  for (const entry of out.split('\0').filter(Boolean)) {
    const file = entry.slice(3)
    const abs = join(top, file)
    let digest = 'deleted'
    try {
      digest = statSync(abs).isFile() ? hashFile(abs) : 'dir'
    } catch {
      digest = 'missing'
    }
    snap.set(file, `${entry.slice(0, 2)}:${digest}`)
  }
  return snap
}

/** Sans git : manifeste (chemin, taille, empreinte) de tous les fichiers hors `node_modules` et `ignore`. */
export function manifestSnapshot(root: string, ignore: string[] = []): Snapshot {
  const snap: Snapshot = new Map()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      const rel = relative(root, abs).split(sep).join('/')
      if (entry.name === 'node_modules' || ignore.some((i) => rel === i || rel.startsWith(`${i}/`)))
        continue
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile()) snap.set(rel, `${statSync(abs).size}:${hashFile(abs)}`)
    }
  }
  walk(root)
  return snap
}

/** Fichiers ajoutés, supprimés ou modifiés entre deux instantanés. */
export function diffSnapshots(before: Snapshot, after: Snapshot): string[] {
  const keys = new Set([...before.keys(), ...after.keys()])
  return [...keys].filter((k) => before.get(k) !== after.get(k)).sort()
}
