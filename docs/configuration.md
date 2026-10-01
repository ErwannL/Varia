# Configuration (`varia.yml`)

Schéma : `packages/config/schema/varia.schema.json` (clés inconnues refusées). Annexes A et B du CDC
acceptées. Points notables :

- `targets.include` (défaut `src/**`), `targets.mode` (`auto` | `declared` | `hybrid`), `targets.depth`
  (`direct` par défaut : les appels transitifs sont observés, pas mutés).
- `inputs.hints` (`range`, `format`, `length`) : bornes déclarées et règle `HINT_VIOLATION`.
- `inputs.skip` : chemins jamais observés en clair ni mutés.
- `inputs.values` : **valeurs déclarées** par chemin (`"exitOn#arg0": ["boom"]`), extension (D-006).
- `mutations.mode` (`quick` 3/chemin, 3 stratégies ; `normal` 10 ; `full` 20), `seed` (`auto` ou entier),
  `per_target`, `limits` (plafonds durs non contournables : chaîne ≤ 1 000 000, tableau ≤ 100 000, …).
- `execution.timeout_ms` (défaut 5000), `parallelism` (1 seulement en J1), `max_output_bytes`.
- `oracle.handled_errors` : `name`, `name_pattern`, `code`, `status`, `message` ; `crash_errors` ;
  `suspicious_accept` (`report` | `ignore`).
- `redaction.fields` / `patterns` (motifs sur les noms de champs), `store_raw_values: false` imposé.
- `storage.location: project` : dossier `.varia/` ajouté à `.git/info/exclude` (jamais `.gitignore`).
