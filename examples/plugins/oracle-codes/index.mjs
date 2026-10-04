// Règle d'oracle d'exemple (J4 X-02) : un code d'erreur `E_VALIDATION*` signale un refus propre.
/** @typedef {import('@varia/plugins').VariaPlugin} VariaPlugin */

/** @type {VariaPlugin} */
export default {
  apiVersion: 1,
  version: '1.0.0',
  name: 'codes',
  oracleRules: [
    {
      id: 'validation-code',
      evaluate: (input) => {
        const code = input.outcome.error?.code
        return typeof code === 'string' && code.startsWith('E_VALIDATION')
          ? { status: 'HANDLED', reason: 'VALIDATION_CODE' }
          : null
      },
    },
  ],
}
