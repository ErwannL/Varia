# @varia/plugins

Extensions externes de Varia (CDC §39, J4 X-02/X-03) : contrats publics (`MutationStrategy`,
`OracleRule`, `Reporter`, `FormatDetector`, `PLUGIN_API_VERSION`), chargement depuis `plugins: [...]`
de `varia.yml`, vérification de `apiVersion`, contrôle du déterminisme et de `Math.random`, plafonds
durs, erreurs `PLUGIN_FAILURE` (jamais fatales). Contrats et modèle de confiance :
[`docs/extensions.md`](../../docs/extensions.md).

- `src/` — contrats, session de chargement, appel synchrone borné d'un thread.
- `runtime/` — hôte exécuté dans le thread (`worker_threads`), chargé tel quel.
- `test/` — tests du paquet.
