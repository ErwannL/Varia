import { createHash } from 'node:crypto'

/** Manifeste du jeu de conformité (`conformance/manifest.json`, P-02). */
export interface ConformanceManifest {
  /** Version du protocole (« majeure.mineure ») que décrivent les fixtures. */
  protocolVersion: string
  /** Empreinte de `conformanceDigest` sur les fichiers de `conformance/cases/`. */
  sha256: string
  /** Fichiers de cas, triés. */
  files: string[]
}

/**
 * Empreinte du contenu des fixtures : SHA-256 de `nom NUL contenu NUL` pour chaque fichier, par ordre
 * de nom (octets UTF-8, fins de ligne LF). Toute modification d'une fixture change l'empreinte.
 */
export function conformanceDigest(files: readonly { name: string; content: string }[]): string {
  const h = createHash('sha256')
  for (const f of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)))
    h.update(`${f.name}\u0000${f.content}\u0000`)
  return h.digest('hex')
}
