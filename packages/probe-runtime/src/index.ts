import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import S from '../runtime/serialize.cjs'

/** Dossier des fichiers exécutés DANS le processus de test (jamais compilés, chargés tels quels). */
export const RUNTIME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'runtime')
/** Fichier de sonde à déclarer comme `setupFilesAfterEnv` (Jest). */
export const PROBE_PATH = join(RUNTIME_DIR, 'probe.cjs')

export const {
  callSiteIdOf,
  deserialize,
  fingerprint,
  hmac,
  sameShape,
  serialize,
  serializeArgs,
  sha256,
  stableStringify,
  testIdOf,
  typeOf,
  typeOfSerialized,
} = S
