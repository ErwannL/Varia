// Stratégie d'exemple « IBAN invalide » (J4 X-02) : purement déterministe, aucune dépendance.
/** @typedef {import('@varia/plugins').VariaPlugin} VariaPlugin */

const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/

/** Chiffres de contrôle corrects (ISO 13616, mod 97) d'un IBAN sans ses chiffres de contrôle. */
function checkDigits(iban) {
  const moved = `${iban.slice(4)}${iban.slice(0, 2)}00`
  let rest = 0
  for (const c of moved) {
    const digits = String(parseInt(c, 36))
    for (const d of digits) rest = (rest * 10 + Number(d)) % 97
  }
  return String(98 - rest).padStart(2, '0')
}

/** Variantes invalides d'un IBAN (ou d'une valeur quelconque dans un champ `iban`). */
export function invalidIbans(original) {
  const base = IBAN.test(original) ? original : 'FR7630006000011234567890189'
  const good = checkDigits(base)
  const wrong = String((Number(good) + 1) % 100).padStart(2, '0')
  return [
    `${base.slice(0, 2)}${wrong}${base.slice(4)}`,
    `ZZ${checkDigits(`ZZ00${base.slice(4)}`)}${base.slice(4)}`,
    base.slice(0, 8),
    `${base}${'0'.repeat(30)}`,
    `${base.slice(0, -1)}!`,
    base.toLowerCase(),
    base.replace(/(.{4})/g, '$1 ').trim(),
    '',
  ]
}

/** @type {VariaPlugin} */
export default {
  apiVersion: 1,
  version: '1.0.0',
  name: 'iban',
  strategies: [
    {
      id: 'invalid-iban',
      supports: (input) =>
        input.type === 'string' &&
        typeof input.original === 'string' &&
        (IBAN.test(input.original) || /iban/i.test(input.pathStr)),
      generate: (input) =>
        invalidIbans(String(input.original))
          .filter((v) => v !== input.original)
          .map((value) => ({ value })),
    },
  ],
}
