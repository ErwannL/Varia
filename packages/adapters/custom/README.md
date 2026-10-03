# @varia/adapter-custom

Adaptateur **custom** (J4, X-01, CDC §9.4) : branche n'importe quel lanceur de tests **sans modifier
Varia**. `varia.yml` déclare `test.framework: custom` et `test.custom` (commande de lancement en argv,
commande de découverte optionnelle, capacités déclarées). Contrat complet :
[`docs/writing-an-adapter.md`](../../../docs/writing-an-adapter.md), section « Adaptateur custom ».

- `src/adapter.ts` — `CustomAdapter` (`fromConfig`, `detect`, `discover`, `prepare`, `run`),
  `parseResults` (fichier `VARIA_RESULTS`), `parseDiscovery` (fichier `VARIA_DISCOVER`),
  `CUSTOM_ENV` (variables du contrat, en plus de celles du protocole de sonde).
- `test/` — tests unitaires, conformité d'adaptateur et rejeu du jeu de conformité du protocole par le
  lanceur factice de [`examples/custom-project`](../../../examples/custom-project/README.md).

Les capacités ne sont **jamais crues sur parole** : `capabilities()` renvoie celles déclarées
(fausses par défaut) et `varia doctor` les vérifie par ses tests de fumée. Aucun fichier `runtime/` :
la sonde est l'affaire du lanceur.
