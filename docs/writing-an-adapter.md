# Écrire un adapter

Implémenter `TestAdapter` (`packages/core/src/adapter.ts`) dans `packages/adapters/<nom>` :
`detect(root)`, `capabilities()`, `prepare(ctx)` (configuration éphémère **hors du projet**),
`run(options)` (un processus supervisé via `runSupervised`, renvoie résultats de tests + événements
JSONL validés par `parseProbeLog`). La sonde respecte `docs/probe-protocol.md`. Aucun code propre au
runner hors de `packages/adapters/*` (vérifié par `tests/architecture.test.ts`). Le CLI choisit
l'adapter ; le moteur et le cœur ne le connaissent pas.

## Conformité (`@varia/adapter-conformance`, CDC §9.3)

Tout adapter doit passer la suite de conformité. Elle prend l'adapter **réel**, un projet d'exemple
dont le runner est installé (seuls ses fichiers de premier niveau sont copiés, `node_modules` est lié :
l'exemple n'est jamais modifié) et le « dialecte » des fichiers de test du runner :

```ts
import { runConformance } from '@varia/adapter-conformance'

const report = await runConformance({
  adapter: new MonAdapter(),
  example: resolve('examples/mon-projet'),
  dialect: { module: 'esm', ext: 'ts', testImport: "import { expect, test } from 'mon-runner'" },
})
expect(report.checks.filter((c) => c.status !== 'PASS')).toEqual([])
```

Les fichiers `src/conformance.<ext>` et `tests/conformance.test.<ext>` doivent correspondre au motif de
tests du projet. Vérifications, toutes sur un projet jetable, via le moteur réel (`runBaseline`,
`planRun`, `runFuzz`) et l'adapter (`prepare`, `run`) :

| Vérification    | Attendu                                                                                |
| --------------- | -------------------------------------------------------------------------------------- |
| `baseline`      | `BASELINE_DONE`, tous les tests verts                                                  |
| `observation`   | `OBSERVE_CALL` de `greet` avec ses arguments (`[{ name: 'Ada' }]`)                     |
| `async`         | cible `async` observée, `TARGET_RETURN` avec `async: true` et la valeur résolue        |
| `multipleCalls` | trois appels de `add` dans un test : rangs de séquence `0, 1, 2`                       |
| `exception`     | `TARGET_THROW` avec `constructorChain` commençant par `ConformanceError`, puis `Error` |
| `parameterized` | `test.each` : deux tests distincts, chacun avec son appel                              |
| `selection`     | `run({ testFile, testName })` n'exécute que ce test et n'observe que ses cibles        |
| `mutation`      | plan sur `greet` ; chaque mutation appliquée (jamais `SKIPPED` ni `INFRA_ERROR`)       |
| `cleanup`       | projet inchangé (manifeste), aucun processus portant un identifiant du run             |

`cleanup` est `UNVERIFIED` là où les processus ne peuvent pas être listés (Windows) : dit, jamais
simulé. Une exception pendant un groupe fait échouer tout le groupe. La suite tourne dans `npm test`
contre Jest et Vitest (`packages/adapter-conformance/test/conformance.test.ts`) et elle échoue contre
des adapters volontairement défaillants (`broken.test.ts`).

## Squelette scaffold (`varia scaffold adapter`, T-02)

Point de départ fonctionnel, généré sans réseau et à l'identique pour un même nom (aucune date) :

1. `varia scaffold adapter mon-lanceur [--dir <dossier>]` crée `<dossier>/mon-lanceur/` (défaut :
   dossier courant). Nom : minuscules, chiffres, tirets isolés, commençant par une lettre, 30 caractères
   au plus. Type ou nom invalide, cible non vide ou qui n'est pas un dossier : refus, rien n'est écrit,
   code de sortie 3.
2. Contenu : `src/index.ts` (`MonLanceurAdapter implements TestAdapter`, identifiant `mon-lanceur`),
   `test/adapter.test.ts` (test unitaire avec un lanceur factice), `test/conformance.test.ts` (la suite
   `runConformance` telle quelle, 9 vérifications), `example/` (projet de conformité Vitest), README,
   `tsconfig.json` strict, `.prettierrc.json` de Varia.
3. `npm install && (cd example && npm install)`, puis `npm run typecheck` et `npm test` : tout passe dès
   la génération, car chaque méthode **délègue** à `VitestAdapter` (forme la plus simple qui passe
   réellement la conformité).
4. Remplacez la délégation méthode par méthode (`detect`, `capabilities`, `prepare`, `run`) par le
   pilotage de votre lanceur, puis adaptez `example/` et le `dialect` de `test/conformance.test.ts`. La
   suite de conformité doit rester verte à chaque étape.

Preuve : `tests/j4/scaffold.test.ts` génère chaque type dans un dossier temporaire, puis exécute
Prettier, `tsc --noEmit` et `vitest run` sur le squelette (paquets `@varia/*` résolus vers les sources
du dépôt par une configuration temporaire posée à côté du squelette).

## Adaptateur custom

Pour brancher un lanceur **sans écrire de code TypeScript ni modifier Varia** (J4 X-01, CDC §9.4) :
le lanceur implémente lui-même le [protocole de sonde](probe-protocol.md) et le contrat ci-dessous ;
`varia.yml` le déclare (paquet `@varia/adapter-custom`).

```yaml
test:
  framework: custom
  custom:
    command: ['node', 'runner.cjs'] # argv, SANS shell ; `node` = le Node qui exécute Varia
    discover: ['node', 'runner.cjs'] # optionnel : liste les tests (sert à `detect`)
    capabilities: { observation: true, argumentMutation: true, perTestSelection: true, cjs: true }
```

`framework: custom` sans `custom` est refusé (`CUSTOM_COMMAND_REQUIRED`). Un chemin relatif en tête de
commande est résolu dans `test.cwd` (racine du projet pour la découverte) ; un nom nu est cherché dans `PATH` (`PATHEXT` sous Windows : pas
de shell, donc pas de script `.cmd` — utilisez `node script.js` ou un exécutable).

**Entrées** (environnement du processus ; les `VARIA_*` hérités de Varia sont retirés, `test.env` et
`NODE_OPTIONS` du projet sont transmis) :

| Variable                                                                                          | Contenu                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `VARIA_MODE`, `VARIA_RUN_DIR`, `VARIA_TARGETS`, `VARIA_REDACT`, `VARIA_PLAN`, `VARIA_MUTATION_ID` | celles du protocole (§2 de la norme) : la sonde du lanceur les lit et écrit `probe-<pid>.jsonl`                            |
| `VARIA_RESULTS`                                                                                   | chemin du **fichier de résultats** à écrire (toujours fourni)                                                              |
| `VARIA_INCLUDE`, `VARIA_EXCLUDE`                                                                  | tableaux JSON d'expressions régulières (issues de `targets.include/exclude`), appliquées au chemin relatif POSIX du module |
| `VARIA_TEST_FILE`, `VARIA_TEST_NAME`                                                              | sélection (si présentes) : fichier relatif POSIX et nom complet **exact** du seul test à exécuter                          |
| `VARIA_COVERAGE_DIR`                                                                              | si présente : y écrire `coverage-summary.json` (format istanbul)                                                           |

**Fichier de résultats** (JSON, écrit d'un coup en fin d'exécution — fichier temporaire puis
renommage) : `{ "tests": [{ "file": "tests/a.test.js", "name": "suite cas", "status": "passed",
"durationMs": 12 }] }`. `status` ∈ `passed`, `failed`, `skipped`, `other` ; `durationMs` nombre ou
absent. `file`/`name` sont ceux des `TEST_START` de la sonde : Varia recalcule le `testId` du protocole
(§8.1, rang des homonymes compris). Fichier absent, illisible ou hors format (processus tué, sortie
brutale) ⇒ **aucun résultat** (`null`), jamais un résultat deviné. Un test non sélectionné est omis.

**Découverte** (optionnelle) : la commande `discover` est lancée avec `VARIA_DISCOVER=<fichier>` (et
aucune variable du protocole) ; elle écrit `{ "version"?: "1.0.0", "tests": [{ "file", "name" }] }` et
sort avec le code 0. Échec ou hors format ⇒ `detect` rend `RUNNER_NOT_FOUND`. Sans découverte, `detect`
vérifie seulement que la commande existe.

**Capacités** : déclarées dans `test.custom.capabilities` (absentes ⇒ fausses), exposées telles quelles
par l'adaptateur et **vérifiées par `varia doctor`** (tests de fumée : observation, mutation appliquée,
sélection d'un test, async, système de modules, isolement, couverture produite, parallélisme). Un
lanceur qui déclare tout sans écrire de journal de sonde obtient `UNSUPPORTED_PROBE`
(`NO_TARGET_MODULE_WRAPPED`, code de sortie 5) ; une sonde d'une majeure inconnue,
`PROBE_PROTOCOL_UNSUPPORTED`.

**Preuve** : `examples/custom-project/runner.cjs`, lanceur factice qui n'importe rien de Varia, passe
la suite de conformité d'adaptateur (`packages/adapters/custom/test/conformance.test.ts`), rejoue tout
le jeu de conformité du protocole (`protocol.test.ts`) et les scénarios du §5 du jalon J4
(`tests/j4/custom*.test.ts`).
