// Liste des fichiers suivis ou à suivre par git (hors ignorés), relative à la racine.
import { execFileSync } from 'node:child_process'

export function trackedFiles() {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      encoding: 'utf8',
    },
  )
  return out.split('\0').filter(Boolean)
}
