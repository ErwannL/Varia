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
