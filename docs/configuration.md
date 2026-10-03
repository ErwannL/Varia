# Configuration (`varia.yml`)

Schéma : `packages/config/schema/varia.schema.json`. Annexes A et B du CDC acceptées.

**Règle (J3) : toute valeur acceptée est implémentée et testée ; une valeur prévue par la
spécification mais non implémentée est refusée à la validation (code de sortie 3) avec un message
explicite** (`docs/notes/configuration.md`).

- `test.framework` (`jest` | `vitest`, sinon détecté) ; `test.command` n'est pas exécutée (Varia lance
  le runner lui-même pour injecter la sonde, CDC §5) : elle sert à reconnaître le framework
  (`npx vitest run` ⇒ Vitest) quand `test.framework` est absent ; `test.env` : variables des processus
  de test ; `test.cwd` : leur répertoire de travail (dans le projet) ; `test.node_options`.
- `targets.include` (défaut `src/**`), `targets.mode` (`auto` | `declared` | `hybrid`), `targets.depth`
  (`direct` par défaut : les appels transitifs sont observés, pas mutés ; `all` : mutés aussi, issues
  marquées `TRANSITIVE`, hors `ci.fail_on` sauf `ci.include_transitive: true`).
- `inputs.hints` (`range`, `format`, `length`) : bornes déclarées et règle `HINT_VIOLATION` (un autre
  type ou un champ supprimé n'est pas une violation).
- `inputs.skip` : chemins jamais observés en clair ni mutés.
- `inputs.values` : **valeurs déclarées** par chemin (`"exitOn#arg0": ["boom"]`), extension (D-006).
- `mutations.mode` (`quick` 3/chemin, 3 stratégies ; `normal` 10 ; `full` 20), `seed` (`auto` ou entier),
  `per_target`, `limits` (plafonds durs : chaîne ≤ 1 000 000, tableau ≤ 100 000, …) ; `limits.memory_mb`
  est appliquée aux processus de test (`--max-old-space-size`) : son dépassement est un `CRASH /
RESOURCE_LIMIT`. `mutations.combine: true` est **refusé** (non implémenté).
- `execution.timeout_ms` (défaut 5000), `max_output_bytes` (dépassement : arbre arrêté, `CRASH /
RESOURCE_LIMIT`). `parallelism` : 1 seulement (autre valeur refusée) ; `isolation: process` seulement.
- `execution.reset` : `environment` et `mocks` valent toujours `true` (un processus neuf par mutation ;
  `false` est refusé) ; `database: command` + `database_command` (exécutée avant chaque mutation, dans le
  projet, avec `test.env` ; échec ⇒ `INFRA_ERROR / RESET_FAILED`) ; `filesystem: tmpdir` (répertoire
  jetable par mutation, `VARIA_TMPDIR`/`TMPDIR`/`TMP`/`TEMP`, supprimé ensuite) ; `filesystem: copy` est
  refusé (non implémenté).
- `oracle.handled_errors` : `name`, `name_pattern`, `code`, `status`, `message` ; `crash_errors` ;
  `suspicious_accept` (`report` | `ignore`) ; `slow_factor` (défaut 10) et `slow_floor_ms` (défaut 100) :
  drapeau `SLOW` quand la durée du test muté dépasse les deux.
- `redaction.fields` / `patterns` (motifs sur les noms de champs) ; `store_raw_values: true` est refusé.
- `storage.location: project` : dossier `.varia/` ajouté à `.git/info/exclude` (jamais `.gitignore`).
- `storage.retention_runs` (défaut 50) : en fin de run, seuls les N derniers runs du projet sont
  gardés ; la purge supprime les tables filles (résultats, mutations, call sites…) mais **conserve les
  issues et les acceptations**, et elle est journalisée (événement `RUNS_PRUNED`). À la demande :
  `varia prune [--keep N]` ; sauvegarde et contrôle de la base : `varia db backup [--out f]`,
  `varia db check` (code 4 si l'intégrité SQLite échoue).
- `integrity.ignore_for_integrity` : dossiers non surveillés (git ou manifeste) ; `watch_ignored`.
