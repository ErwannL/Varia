export default {
  apiVersion: 1,
  name: 'leve',
  // Extension saine du même plugin : reste active (seule l'extension en erreur est désactivée).
  oracleRules: [{ id: 'saine', evaluate: () => null }],
  strategies: [
    {
      id: 's',
      supports: () => true,
      generate: () => {
        throw new Error('panne')
      },
    },
  ],
}
