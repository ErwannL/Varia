# Sonde dans Jest : pièges connus (J0)

- **Pas d'`instanceof` côté oracle** : les erreurs sont jugées par `constructorChain` (contexte `vm`).
- **État sur `globalThis.__varia`** : `jest.resetModules` réévalue les modules (et donc le pied de
  module ajouté par le transform) mais ne touche pas aux globales ; les séquences continuent.
- **`preset` Jest** (ex. `ts-jest`) : le fusionner avant de générer le transform, sinon le transform
  Varia masque celui du preset (`applyPreset`).
- **Cache de transformation** : propre au run (`tmp/<run>/jest-cache`) et sel = `runId` ; il contient
  une copie du code source du projet (pas des valeurs observées).
- **Sortie JSON de Jest lue sur stdout** (`--json` sans `--outputFile`) : rien n'est écrit sur disque.
- **`process.exit` dans un test** : Jest meurt sans rapport JSON ⇒ `CRASH / PROCESS_EXIT`.
- **ESM natif** : aucun module n'est transformé ⇒ aucun `DISCOVER` ⇒ non supporté (J2).
- **Cibles mockées** (`jest.mock`) : jamais observées ; détection `MOCKED_TARGET` partielle.
- **Sélection d'une mutation** : `--runTestsByPath <fichier> --testNamePattern ^<nom complet>$`.
- **Pas de préfixe `node:` dans le code chargé par Jest** (`probe.cjs`, `serialize.cjs`, `transform.cjs`) :
  les anciennes versions de Jest (26, projet externe immutability-helper) ne résolvent pas
  `require('node:fs')` depuis un fichier de setup. Utiliser `require('fs')`. Idem pour les globaux récents : Jest 24 n'expose pas `performance`
  (importer `require('perf_hooks')`). Testé par `tests/runtime-compat.test.ts`.
