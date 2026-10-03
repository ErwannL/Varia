export default {
  apiVersion: 1,
  name: 'boucle',
  // Extension saine du même plugin : désactivée avec lui quand le délai est dépassé.
  oracleRules: [{ id: 'saine', evaluate: () => null }],
  strategies: [
    {
      id: 's',
      supports: () => true,
      generate: () => {
        for (;;) {
          // boucle synchrone infinie
        }
      },
    },
  ],
}
