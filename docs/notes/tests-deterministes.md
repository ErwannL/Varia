# Tests déterministes (J3, F-02)

- Un scénario qui compare des runs (états d'issues, cache, historique) n'utilise QUE des cibles qui
  terminent vite et toujours de la même façon : `deterministicConfig()` (`tests/j1/helpers.ts`).
- Jamais d'assertion sur un statut qui dépend de la vitesse (TIMEOUT d'une cible qui termine). Les
  délais sont explicites ; le délai d'une mutation inclut le démarrage mesuré du runner (D-029).
- Les cibles qui bouclent (`repeat`) ne servent qu'aux scénarios de TIMEOUT eux-mêmes (J0-8, A-11).
- Effets asynchrones (rejet non géré, sortie) : rendre l'effet SYNCHRONE ou borné dans l'exemple
  (`shout` écrit en synchrone avec reprise sur EAGAIN), sinon une course entre deux limites rend le
  résultat aléatoire.
- Vérifier sous charge : lancer la suite pendant qu'une autre tourne (`--maxWorkers=2`).

## Rendu asynchrone et mesures de durée (J3, CI multi-OS)

- Tableau de bord : un titre statique peut s'afficher avant les données. Les assistants d'ouverture
  attendent le titre PUIS la disparition du chargeur (`loader-logo`) ; sinon `findBy…`, jamais
  `getBy…` juste après un rendu.
- Une assertion qui dépend d'une durée mesurée (drapeau `SLOW`) n'est faite de bout en bout que dans
  le sens robuste (charge ≫ référence) ; les cas limites (au-dessous, plancher) sont prouvés par des
  tests déterministes de l'oracle, avec des durées injectées.

## Enfant tué par SIGKILL (scénarios de reprise)

- Jamais la CLI de tsx pour un enfant à tuer : elle lance un petit-enfant Node qui survit au SIGKILL
  et continue d'écrire des résultats pendant la reprise (CI macOS : 9 mutations rejouées au lieu de
  8). Utiliser `tests/j4/tsx-child.ts` (`node --import <loader tsx>`, un seul processus). Preuve
  locale : `kill -9` du parent ⇒ 0 processus restant avec `--import`, 1 avec la CLI.
