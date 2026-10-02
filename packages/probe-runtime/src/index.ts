import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Chargé par le `require` de Node (jamais par Vite) : une seule instance du module, mesurée une seule
// fois par la couverture (deux chargements différents d'un même fichier faussent la fusion).
const S = createRequire(import.meta.url)(
  '../runtime/serialize.cjs',
) as typeof import('../runtime/serialize.cjs')

/** Dossier des fichiers exécutés DANS le processus de test (jamais compilés, chargés tels quels). */
export const RUNTIME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'runtime')
/** Fichier de sonde à déclarer comme `setupFilesAfterEnv` (Jest). */
export const PROBE_PATH = join(RUNTIME_DIR, 'probe.cjs')

export const {
  callSiteIdOf,
  deserialize,
  fingerprint,
  hmac,
  serialize,
  serializeArgs,
  sha256,
  stableStringify,
  testIdOf,
  typeOf,
  typeOfSerialized,
} = S
