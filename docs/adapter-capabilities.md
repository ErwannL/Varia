# Capacités des adapters

`varia doctor` distingue capacités **déclarées** et **vérifiées** (test de fumée réel : une baseline
observée et une mutation appliquée sur le projet). Statuts : `VERIFIED`, `NOT_VERIFIED`, `UNSUPPORTED`.

| Capacité (Jest, J1)                | Déclarée | Vérifiée par doctor                           |
| ---------------------------------- | -------- | --------------------------------------------- |
| observation, cjs                   | oui      | appels observés                               |
| argumentMutation                   | oui      | `MUTATE_CALL applied`                         |
| perTestSelection                   | oui      | un seul test exécuté au rejeu                 |
| asyncTargets                       | oui      | un retour asynchrone observé                  |
| isolatedProcess                    | oui      | un processus par exécution                    |
| testParameters                     | oui      | non vérifiable génériquement (`NOT_VERIFIED`) |
| esm, mocks, coverage, parallelSafe | non      | `UNSUPPORTED`                                 |
