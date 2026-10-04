# Conteneur, hôtes autorisés, `--data-path`

- **Écoute hors boucle locale = opt-in** : `varia dashboard --host 0.0.0.0` exige `--allow-remote` (exit 3 sinon,
  CDC §19.2). Le `Dockerfile` le passe explicitement ; c'est l'hôte qui publie le port sur `127.0.0.1`.
- **Anti rebinding** : `hostHeaderAllowed` (`packages/engine/src/hosts.ts`) juge `Host` et `Origin` : boucle locale
  ou `VARIA_ALLOWED_HOSTS`, avec le port lié (ou celui de l'entrée). Une entrée invalide est refusée, jamais ignorée
  (« accepté = implémenté », voir `configuration.md`). `nom:port` sert aux ports **publiés** différents du port lié.
- **`--data-path`** : le dossier de données dérive du chemin ABSOLU du projet (`<nom>-<hash>`), donc un conteneur
  qui monte le projet ailleurs ne retrouve pas les runs de l'hôte. `resolveDataPath` sert un dossier de données sans
  projet : un `varia.db` direct, ou une racine avec un seul projet ; plusieurs ⇒ erreur qui les liste, on ne devine pas.
- Le serveur ouvre la base au démarrage : un conteneur lancé avant le premier `varia test` ne l'a pas (redémarrer).
- Image vérifiée à la main : build, `docker run` avec un port publié différent, `/health` 200, `Host` forgé 403,
  état `healthy`. Pas de test d'image en CI.
