// Pont typé vers le module partagé de la sonde (CommonJS vérifié par tsc via checkJs).
import S from '../runtime/serialize.cjs'

export const {
  callSiteIdOf,
  deserialize,
  fingerprint,
  sameShape,
  serialize,
  sha256,
  stableStringify,
  testIdOf,
  typeOfSerialized,
} = S
