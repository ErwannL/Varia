# @varia/cli

CLI `varia` (CDC §27) : `init`, `doctor`, `config --check/--print`, `baseline`, `plan`, `fuzz`, `test`,
`replay`, `report`, `clean`, `dashboard`. Options globales : `--data-dir`, `--lang fr|en`, `--quiet`,
`--json`, `-C/--project`. Tous les textes viennent de `@varia/i18n` ; bannière `Varia par Orqea · v…`
sur stderr (absente avec `--quiet`/`--json`). Codes de sortie : 0, 1 résilience, 2 baseline, 3 config,
4 infra / `PROJECT_MUTATED`, 5 sonde non supportée, 130 interruption.

- `src/program.ts` — commandes (`runCli`, testable en mémoire). `src/main.ts` — entrée du binaire.
- `src/summary.ts` — résumé et politique de sortie. `src/io.ts` — sorties i18n. `test/` — tests.

`varia dashboard` : `--port`, `--host` (défaut 127.0.0.1 ; hors boucle locale ⇒ `--allow-remote` obligatoire), `--data-path <dossier>` (sert un dossier de données sans projet). Voir `docs/INTEGRATION.md`.
