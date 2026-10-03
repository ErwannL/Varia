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
