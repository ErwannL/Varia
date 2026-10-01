<p align="center"><img src="docs/assets/logo-animated.svg" width="140" alt="Varia"></p>

# Varia by Orqea

> Propulsé par [Orqea](https://orqea.dev) · Développé par [Erwann Laplante](https://github.com/ErwannL)

_Your tests prove that your software works. Varia tests what happens when it doesn't get what it expects._

Varia est une application **locale** de test de résilience par perturbation de données. Elle
exécute les tests d'un projet tels quels, **observe les appels réels** faits au code testé, puis
rejoue chaque test en **modifiant une seule valeur d'entrée** et classe le comportement de la cible
(`HANDLED`, `CRASH`, `TIMEOUT`, `SUSPICIOUS_ACCEPT`…).

## Installation

```bash
git clone https://github.com/ErwannL/Varia ../varia
cd ../varia && npm ci && npm run build
cd ../my-application && ../varia/bin/varia test
```

## État

Voir [`STATE.md`](STATE.md) et les rapports de jalon dans [`reports/`](reports/). La
spécification de référence est [`docs/SPEC.md`](docs/SPEC.md).

## Dossiers

| Dossier     | Rôle                                                      |
| ----------- | --------------------------------------------------------- |
| `docs/`     | Spécification, notes durables, intégration                |
| `brand/`    | Identité visuelle (logos fixe/animé, déclinaisons raster) |
| `scripts/`  | Contrôles de qualité et outils de développement           |
| `reports/`  | Rapports de fin de jalon                                  |
| `spike/`    | Spike J0 (supprimé à la fin de J1)                        |
| `packages/` | Paquets du monorepo (npm workspaces)                      |
| `examples/` | Projets d'exemple utilisés par les tests                  |

## Commandes

```bash
npm run check      # typage, lint, format, contrôles, tests
npm test           # tests Vitest
```

## Licence

MIT — voir [`LICENSE`](LICENSE).
