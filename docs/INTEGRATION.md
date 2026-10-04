# Intégrer Varia à un autre outil (Orqea, conteneur, serveur partagé)

Varia est une application **compagne d'Orqea** et reste un outil **autonome** : rien ici n'est propre à
Orqea, tout est configurable. **Aucune authentification partagée, aucun jeton, aucune passation** : le
dashboard est en lecture seule et n'a pas de compte (CDC §1.4). Orqea l'embarque tel quel dans sa console
(profil Docker Compose `varia`, voir le dépôt Orqea, `Docs/VARIA.md`).

## Fichiers de marque

- `brand/varia.svg` (logo fixe) et `brand/varia-animated.svg` (logo animé, CSS seul, coupé sous
  `prefers-reduced-motion`). Dérivés raster : `brand/png/`, `brand/favicon.ico`.

## Variables d'environnement

| Variable              | Rôle                                                                                                                                                                                                          | Défaut              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `VARIA_ORQEA_URL`     | URL d'Orqea : liens « Propulsé par Orqea » et « ← Retour sur Orqea » (`target="_top"`), origine autorisée par `frame-ancestors`. Exposée par `/health` sous `orqeaUrl`.                                       | `https://orqea.dev` |
| `VARIA_ALLOWED_HOSTS` | Hôtes (en plus de la boucle locale) acceptés dans les en-têtes `Host` et `Origin`, séparés par des virgules : `nom` (port d'écoute) ou `nom:port` (port **publié**, ex. `localhost:4322`). Invalide ⇒ exit 3. | aucun               |
| `VARIA_PUBLIC_URL`    | URL publique sous laquelle un hôte joindra Varia (réservée : **non lue** par Varia ; à utiliser par l'intégrateur pour construire l'URL de l'iframe).                                                         | aucun               |

## Serveur

- Lancement : `varia dashboard [--port 4321]` depuis le projet cible (ou `-C <projet>`).
- Options : `--host <adresse>` (défaut **127.0.0.1**), `--allow-remote` (obligatoire pour toute adresse hors
  boucle locale, ex. `0.0.0.0` : sinon exit 3, CDC §19.2), `--data-path <dossier>` (sert un dossier de données
  **sans projet à côté** : le dossier qui contient `varia.db`, ou une racine `--data-dir` ne contenant qu'un seul
  projet ; plusieurs ou aucun ⇒ exit 3 qui liste les candidats).
- Page d'accueil : `/` (vue d'ensemble du dernier run) ; routes du client en fragment (`/#/runs/<id>`).
- Santé : `GET /health` → `{ status, name: "varia", version, api, orqeaUrl, database }`.
- API en lecture seule sous `/api/v1` (voir `packages/api/README.md`).
- Anti « DNS rebinding » : l'en-tête `Host` (et `Origin`) doit être la boucle locale ou figurer dans
  `VARIA_ALLOWED_HOSTS`, avec le bon port ; sinon 403 `FORBIDDEN_HOST`.

## Conteneur

Un `Dockerfile` à la racine construit une image qui **sert** les résultats (il ne lance aucun test) :

```bash
docker build -t varia .
varia -C mon-projet --data-dir .varia test          # sur la machine : écrit .varia/projects/<nom>-<hash>/
docker run --rm -p 127.0.0.1:4321:4321 -v "$PWD/.varia:/data:ro" varia
```

- Le dossier de données dépend du **chemin absolu** du projet : monter ce dossier (`/data`) et laisser
  `--data-path` le résoudre évite de reproduire le chemin de l'hôte dans le conteneur.
- Le conteneur écoute sur `0.0.0.0:4321` (c'est à l'hôte de publier le port sur `127.0.0.1`). Si le port
  publié diffère (`-p 127.0.0.1:4399:4321`), ajouter `-e VARIA_ALLOWED_HOSTS=localhost:4399`.
- `/data` doit déjà contenir un `varia.db` : lancer d'abord `varia test`, puis (re)démarrer le conteneur
  (le serveur ouvre la base au démarrage).
- Santé du conteneur : `HEALTHCHECK` sur `/health`.

## Comportement en iframe

- `Content-Security-Policy: frame-ancestors 'self' <origine de VARIA_ORQEA_URL>` : seule Orqea (et Varia
  elle-même) peut l'embarquer.
- Dans une `<iframe>`, le lien « ← Retour sur Orqea » est **masqué** ; « Propulsé par Orqea » reste
  (ouvre Orqea dans la fenêtre principale, `target="_top"`).
- **Attention (constaté en test, Chromium)** : une page Orqea **publique** qui embarque Varia servi sur
  `127.0.0.1` est bloquée par les protections _Local Network Access / Private Network Access_ du
  navigateur (requête vers le réseau local depuis une origine publique). Il faudra soit servir Varia
  derrière une origine publique (`VARIA_PUBLIC_URL`), soit obtenir l'autorisation de l'utilisateur
  selon le mécanisme du navigateur. Vérifié avec `scripts/dashboard-check.mjs`, qui désactive ces
  protections uniquement pour tester le rendu.
