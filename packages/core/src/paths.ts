import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

/** Répertoire de données utilisateur standard de la plateforme (CDC §4.3). */
export function userDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (platform === 'win32') return env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local')
  if (platform === 'darwin') return join(home, 'Library', 'Application Support')
  return env['XDG_DATA_HOME'] ?? join(home, '.local', 'share')
}

/** `<user-data>/varia/projects/<nom>-<empreinte-du-chemin>` ; `dataDir` force la racine Varia. */
export function projectDataDir(projectRoot: string, dataDir?: string): string {
  const abs = resolve(projectRoot)
  const hash = createHash('sha256').update(abs).digest('hex').slice(0, 12)
  const root = dataDir ?? join(userDataDir(), 'varia')
  return join(root, 'projects', `${basename(abs)}-${hash}`)
}
