'use strict'

// Longueur d'IBAN par pays (extrait). Défaut volontaire (J4 X-02) : un pays inconnu n'est pas
// refusé proprement, la lecture de `.length` sur `undefined` lève une TypeError (CRASH).
const COUNTRIES = { FR: { length: 27 }, DE: { length: 22 }, BE: { length: 16 } }

function validationError(message) {
  return Object.assign(new Error(message), { code: 'E_VALIDATION_IBAN' })
}

/** Reste modulo 97 de l'IBAN réarrangé (ISO 13616). */
function mod97(iban) {
  let rest = 0
  for (const c of `${iban.slice(4)}${iban.slice(0, 4)}`)
    for (const d of String(parseInt(c, 36))) rest = (rest * 10 + Number(d)) % 97
  return rest
}

function transfer({ iban, amount, token }) {
  void token
  if (typeof iban !== 'string') throw validationError('iban must be a string')
  if (iban.length !== COUNTRIES[iban.slice(0, 2)].length)
    throw validationError('iban has a wrong length')
  if (!/^[A-Z0-9]+$/.test(iban)) throw validationError('iban has invalid characters')
  if (mod97(iban) !== 1) throw validationError('iban checksum mismatch')
  return { status: 'sent', iban, amount }
}

module.exports = { transfer }
