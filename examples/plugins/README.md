# examples/plugins/

Extensions d'exemple (J4 X-02), testées de bout en bout avec la seule API publique de
`@varia/testkit` (`tests/j4/plugins-examples.test.ts`) et dans un vrai run
(`tests/j4/plugins-e2e.test.ts`, projet `examples/plugins-project`). Contrats : `docs/extensions.md`.

- `iban/` — stratégie « IBAN invalide », purement déterministe.
- `oracle-codes/` — règle d'oracle : erreur à code `E_VALIDATION*` ⇒ `HANDLED`.
- `csv-reporter/` — rapporteur CSV des mutations.
