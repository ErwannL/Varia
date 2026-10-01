# Intégration future de Varia dans Orqea

Varia est une application **compagne d'Orqea**. Ce document décrit seulement ce qu'il faut pour la
brancher plus tard ; **aucune authentification partagée, aucun jeton, aucune passation** n'est
implémenté (chantier distinct).

## Fichiers de marque

- `brand/varia.svg` (logo fixe) et `brand/varia-animated.svg` (logo animé, CSS seul, coupé sous
  `prefers-reduced-motion`). Dérivés raster : `brand/png/`, `brand/favicon.ico`.

## Variables d'environnement

| Variable           | Rôle                                                                                                                                             | Défaut              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `VARIA_ORQEA_URL`  | URL d'Orqea : liens « Propulsé par Orqea » et « ← Retour sur Orqea » (`target="_top"`), origine autorisée par `frame-ancestors`                  | `https://orqea.dev` |
| `VARIA_PUBLIC_URL` | URL publique sous laquelle Orqea joindra Varia (réservée : **non lue** par Varia en J1 ; à utiliser par Orqea pour construire l'URL de l'iframe) | aucun               |

## Serveur

- Lancement : `varia dashboard [--port 4321]` depuis le projet cible (ou `-C <projet>`).
- Écoute sur **127.0.0.1** (boucle locale), port **4321** par défaut.
- Page d'accueil : `/` (vue d'ensemble du dernier run) ; routes du client en fragment (`/#/runs/<id>`).
- Santé : `GET /health` → `{ status, name: "varia", version, api, orqeaUrl, database }`.
- API en lecture seule sous `/api/v1` (voir `packages/api/README.md`).

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
