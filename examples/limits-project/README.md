# examples/limits-project/

Projet d'exemple (Jest 29, CommonJS) des limites d'exécution, ajouté en J3 :

| Export  | Comportement                                                                  | Point |
| ------- | ----------------------------------------------------------------------------- | ----- |
| `grow`  | accumule des blocs ; boucle sans fin (et épuise la mémoire) si non entier ≥ 0 | A-03  |
| `shout` | écrit N lignes de 1 Mo sur stdout                                             | A-03  |
| `tally` | 1 ms de travail par élément : un grand tableau est lent sans être un timeout  | A-10  |

La configuration de Varia est fournie par les tests (`--config`), hors du projet. Dossiers `src/` et
`tests/` : contenu lu comme données par Varia (pas de README).
