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
- **Vitest sans fichier de config** : Vitest remonte l'arborescence et peut charger la config d'un
  dépôt PARENT (constaté avec `destr` cloné sous `examples/external/`). Le lanceur passe `config: false`
  quand le projet n'a pas de config. Le setup est passé en option CLI (`setupFiles`).
- **`process` dans le contexte vm** : une copie ; `process.on('unhandledRejection')` y est sans effet.
  Le transform (vrai processus) publie `process` sur le module `async_hooks` (`Symbol.for('varia.process')`),
  la sonde s'y abonne au premier `wrapExports` — après le `setup` de jest-circus, qui retire et restaure
  les écouteurs existants (D-025).
- **Sonde défensive** : jamais d'exception de la sonde vers la cible ; `PROBE_ERROR` ou marqueur stderr
  `[varia] PROBE_ERROR` (D-025). Les fichiers `runtime/` se testent EN PROCESSUS par `createRequire`
  (jamais par `import`, que Vite transformerait : mesure de couverture fausse, docs/notes/couverture.md).
