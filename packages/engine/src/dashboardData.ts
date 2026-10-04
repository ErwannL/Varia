import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { VariaError } from './errors.js'

/**
 * Dossier de données d'UN projet pour `varia dashboard --data-path` (conteneur, serveur partagé…),
 * sans projet à côté. Accepte soit le dossier qui contient `varia.db`, soit une racine de données
 * (`--data-dir`) ne contenant qu'un seul projet. Plusieurs projets ou aucun ⇒ erreur de configuration
 * qui liste les candidats : on ne devine jamais lequel afficher.
 */
export function resolveDataPath(path: string): string {
  const abs = resolve(path)
  if (existsSync(join(abs, 'varia.db'))) return abs
  const root = join(abs, 'projects')
  const found = existsSync(root)
    ? readdirSync(root)
        .filter((d) => existsSync(join(root, d, 'varia.db')))
        .sort()
    : []
  if (found.length === 1) return join(root, String(found[0]))
  throw new VariaError(
    'CONFIG_FAILURE',
    'dossier de données introuvable ou ambigu',
    found.length === 0
      ? [`${abs} : aucun varia.db (lancez d’abord « varia test » sur le projet)`]
      : found.map(
          (d) => `${abs} : plusieurs projets, choisissez un dossier de ${join('projects', d)}`,
        ),
  )
}
