# Lancer Varia depuis le tableau de bord (`--allow-run`)

Le tableau de bord est **en lecture seule par défaut**. Avec `varia dashboard --allow-run`, la page **Lancer**
(`#/run`) propose trois boutons : **baseline**, **test rapide**, **test complet**, avec un journal en direct et un
bouton d'arrêt. Sans l'option, la page existe quand même et explique comment l'activer (et donne les commandes
équivalentes pour un terminal).

## Ce que ça lance

Varia **lui-même**, relancé dans le projet du tableau de bord avec les mêmes options globales
(`-C`, `-c`, `--data-dir`, `--lang`) : `varia baseline`, `varia test --quick`, `varia test`. Rien d'autre.

## Règles (tests dans `packages/engine/test/jobs.test.ts`, `packages/api/test/jobs.test.ts`)

- 🔴 **Fermé par construction** : trois types de travaux, des entiers bornés (`--max-mutations` 1 à 100 000,
  `--max-time` 10 à 86 400 s), **jamais** une chaîne de l'appelant dans la ligne de commande. La baseline refuse les
  paramètres de test (« accepté = implémenté »).
- **Opt-in et local** : refusé avec `--allow-remote`, hors boucle locale, ou avec `--data-path` (lecture seule d'une
  base d'ailleurs) ; exit 3. Jamais dans le conteneur d'Orqea (qui reste en lecture seule).
- **Jeton** : `POST /api/v1/jobs` et `DELETE /api/v1/jobs/:id` exigent `x-varia-token` (même mécanisme que les
  acceptations). Sans `--allow-run`, toutes les routes de travaux répondent `403 RUN_DISABLED`.
- **Un seul travail à la fois** (`409 JOB_RUNNING`), les 10 derniers conservés en mémoire, journaux dans un dossier
  temporaire supprimé à l'arrêt du serveur ; à l'arrêt du serveur, le travail en cours est tué avec son arbre de
  processus.
- **Codes de sortie** : 0 et 1 = `DONE` (1 = des problèmes de résilience ont été **trouvés**, le travail est allé au
  bout) ; autre = `FAILED` ; arrêt demandé = `CANCELED`.
- **La base apparaît après le démarrage** : la première baseline la crée ; le serveur l'ouvre paresseusement.
- `/health` expose `canRun` (utilisé par la page pour choisir entre boutons et explication).
