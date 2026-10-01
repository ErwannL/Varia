# @varia/probe-runtime

Code exécuté **dans le processus de test** (CDC §10) :

- `runtime/probe.cjs` — sonde (`setupFilesAfterEnv` Jest) : enveloppe les exports, suit la profondeur
  par `AsyncLocalStorage`, applique au plus une mutation sur copie profonde, écrit des JSONL redigés.
- `runtime/serialize.cjs` — sérialisation étiquetée (§10.7), redaction, empreintes, identités
  (`testIdOf`, `callSiteIdOf`) ; partagé avec l'orchestrateur.
- `src/index.ts` — chemins (`PROBE_PATH`, `RUNTIME_DIR`) et pont typé vers `serialize.cjs`.

Les fichiers `runtime/*.cjs` sont du CommonJS vérifié par `tsc --checkJs` (strict) : ils ne doivent
dépendre que de modules Node intégrés. Sous-dossiers : `runtime/`, `src/`, `test/`.
