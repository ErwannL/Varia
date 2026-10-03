# @varia/testkit

Kit de test public de Varia (J4 T-01), documenté dans [`docs/extensions.md`](../../docs/extensions.md) :

- **Fabriques** : `callSite()`, `inputsOf()`, `inputAt()`, `mutationOf()`, `planFor()` — mêmes
  sérialisation, redaction et catalogue que Varia.
- **Doubles de sonde** : `probeEvent()`, `probe.*`, `serializedError()`, `adapterRun()`.
- **Harnais d'exécution d'une mutation** : `runMutation()` (oracle intégré + règles d'extensions).
- **Assertions sur les statuts** : `assertStatus()` (indépendante du lanceur de tests).
- **Extensions** : `withPlugin()`, `generateWith()`, `checkDeterminism()`, `assertDeterministic()`,
  `evaluateRules()`, `renderWith()` — chargement et contrôles identiques à ceux d'un run.
- **Base de démonstration** (interne aux tests de Varia) : `seedDatabase()`.

- `src/` — code.
