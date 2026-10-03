# src/

- `index.ts` — base de démonstration (`seedDatabase`) et réexport de l'API publique.
- `factories.ts` — call sites, entrées, mutations, plans.
- `probe.ts` — doubles de sonde (messages du protocole, exécution d'adapter scriptée).
- `harness.ts` — exécution et classement d'une mutation dans le processus de test.
- `assertions.ts` — assertions sur les statuts.
- `extensions.ts` — tester une extension comme Varia l'exécute (déterminisme, règles, rendus).
