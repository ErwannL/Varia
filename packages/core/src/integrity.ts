import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export type Snapshot = Map<string, string>

const hashFile = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')

/** Le chemin relatif (séparateur `/`) est-il dans un des dossiers ignorés ? */
export const isIgnored = (rel: string, ignore: string[]) =>
  ignore.some((i) => rel === i || rel.startsWith(`${i}/`))

/**
 * Avec git (CDC §5) : `git status --porcelain=v1 -z -uall` du projet + empreinte de chaque fichier
 * listé. `-uall` détaille les dossiers non suivis (sans lui, une écriture dans un dossier déjà non
 * suivi passerait inaperçue : git ne montrerait que `?? dossier/`). Les dossiers `ignore` (chemins
 * relatifs au projet, ex. `dist`) ne sont pas surveillés.
 */
export function gitSnapshot(root: string, ignore: string[] = []): Snapshot {
  const out = execFileSync('git', ['status', '--porcelain=v1', '-z', '-uall', '--', '.'], {
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
    if (isIgnored(relative(root, abs).split(sep).join('/'), ignore)) continue
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
      if (entry.name === 'node_modules' || isIgnored(rel, ignore)) continue
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
