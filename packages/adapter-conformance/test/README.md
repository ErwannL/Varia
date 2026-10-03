# test/

- `conformance.test.ts` — la suite contre les adapters réels Jest (`examples/jest-project`) et Vitest
  (`examples/vitest-project`).
- `broken.test.ts` — la suite échoue contre des adapters volontairement défaillants (filtre ignoré,
  mutation jamais appliquée, fichier laissé, panne totale).
