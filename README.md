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
cd ../varia && npm ci && npm run build      # Node >= 20.10
cd ../my-application && ../varia/bin/varia test
```

Rien n'est ajouté au projet cible : les données vivent dans le répertoire utilisateur (ou `--data-dir`),
la configuration peut rester hors du projet (`--config`). Voir [`docs/getting-started.md`](docs/getting-started.md).

## Lanceurs supportés

Jest, Vitest, Mocha, pytest, PHPUnit, JUnit 5 et `custom` (tout lanceur qui implémente le
[protocole de sonde](docs/probe-protocol.md)) : `varia list adapters`. Le niveau de vérification de
chaque capacité (`VERIFIED`, `NOT_VERIFIED`, `UNSUPPORTED`), mesuré par le vrai `varia doctor` sur le
projet d'exemple de chaque adaptateur, est dans la matrice générée
[`docs/adapter-capabilities.md`](docs/adapter-capabilities.md) (non recopiée ici). Stratégie
d'injection et limites de chaque adaptateur : [`docs/writing-an-adapter.md`](docs/writing-an-adapter.md).

## Prérequis

- Node >= 20.10 (tous les adaptateurs).
- pytest : Python 3.11 (venv du projet : `.venv`, `venv`, sinon `python3`).
- PHPUnit : PHP 8.3 + composer (pcov pour la couverture de la sonde PHP dans les tests de Varia).
- JUnit : Java 21 + Maven (préparation hors ligne : dépendances déjà résolues dans le dépôt Maven local).

## Commandes

| Commande                                                 | Rôle                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `varia doctor`                                           | capacités de la sonde **vérifiées** sur le projet (`UNSUPPORTED_PROBE` sinon) |
| `varia test`                                             | baseline + stabilité, plan (avec estimation de durée), fuzz, rapport          |
| `varia baseline` / `plan` / `fuzz [--resume <run>]`      | étapes séparées, reprise idempotente                                          |
| `varia replay <mutation-id>`                             | rejoue exactement une mutation                                                |
| `varia report [run] [--out f.json]`                      | rapport JSON versionné (et HTML, JUnit, SARIF, Markdown, extensions)          |
| `varia ci`                                               | mode CI non interactif : test + rapports + politique d'échec                  |
| `varia accept <issue>` / `compare <a> <b>`               | accepter une issue ; comparer deux runs                                       |
| `varia dashboard`                                        | dashboard local en lecture seule (http://127.0.0.1:4321)                      |
| `varia scaffold adapter\|strategy\|rule\|reporter <nom>` | squelette d'adaptateur ou d'extension                                         |
| `varia init`, `config --check/--print`, `clean`, `prune` | configuration et nettoyage                                                    |

Liste complète : `varia --help`.

## État

Jalons **J0** (GO), **J1**, **J2** et **J3** acceptés ; **J4** en cours (docs, tableau de bord,
exemples/CI) : voir [`reports/`](reports/) et [`STATE.md`](STATE.md). Spécification de référence :
[`docs/SPEC.md`](docs/SPEC.md). Documentation : [`docs/README.md`](docs/README.md).

## Dossiers

| Dossier     | Rôle                                                                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/` | Paquets du monorepo (npm workspaces) : `core`, `config`, `database`, `engine`, `cli`, `api`, `dashboard`, `reporters`, `probe-*`, `adapters/*`, `adapter-conformance`, `plugins`, `i18n`, `testkit` |
| `bin/`      | Binaire `varia`                                                                                                                                                                                     |
| `examples/` | Projets cibles des tests (un par adaptateur, TypeScript, ESM, mocks, limites) et extensions d'exemple (`examples/plugins`)                                                                          |
| `docs/`     | Spécification, documentation, notes durables, intégration Orqea                                                                                                                                     |
| `brand/`    | Identité visuelle (logos fixe/animé, déclinaisons raster)                                                                                                                                           |
| `scripts/`  | Contrôles qualité, marque, projet externe, vérification navigateur                                                                                                                                  |
| `tests/`    | Tests transverses et d'acceptation                                                                                                                                                                  |
| `reports/`  | Rapports de fin de jalon et captures                                                                                                                                                                |

## Développement

```bash
npm ci && npm run examples:install   # venv Python, composer install, agent Java (outils ci-dessus)
npm run check          # typage, lint, format, contrôles, build, tests + couverture par fichier
npm run check:fast     # sans build ni tests
npm run mutation-check # preuve que les tests peuvent échouer (mutations manuelles du code)
npm run brand          # régénère les fichiers de marque
```

## Licence

MIT — voir [`LICENSE`](LICENSE).
