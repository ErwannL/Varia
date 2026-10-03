# Extensions de Varia (J4 X-02, X-03, T-01)

Une extension ajoute à Varia des **stratégies de mutation**, des **détecteurs de format**, des
**règles d'oracle** ou des **rapporteurs**, sans modifier Varia. Contrats publics : paquet
`@varia/plugins` (`packages/plugins/src/contracts.ts`). Kit de test : `@varia/testkit`. Exemples :
`examples/plugins/` (stratégie « IBAN invalide », règle d'oracle, rapporteur CSV).

## Déclarer des extensions

```yaml
# varia.yml
plugins:
  - ./varia/iban.mjs # chemin : commence par « . » ou « / » (ou absolu), relatif au fichier de config
  - varia-plugin-maison # sinon : paquet installé dans le projet (résolu depuis sa racine)
```

- Un chemin relatif est résolu depuis le **dossier du fichier de configuration** (celui de
  `--config` s'il est donné), sinon depuis la racine du projet.
- Un paquet est résolu comme `require.resolve` depuis la racine du projet (condition `require` ou
  `default` de son champ `exports`, ou `main`). Module ESM (`export default`) ou CommonJS
  (`module.exports`).
- Les extensions sont chargées **dans l'ordre de la liste**.

## Le module d'extension

```js
// @ts-check
/** @type {import('@varia/plugins').VariaPlugin} */
export default {
  apiVersion: 1, // version du contrat : vérifiée au chargement
  name: 'iban', // espace de noms : [a-z0-9][a-z0-9-]*
  strategies: [{ id: 'invalid-iban', supports: (input) => …, generate: (input, ctx) => [{ value: … }] }],
  formatDetectors: [{ id: 'code-postal', detect: (v) => …, invalidValues: (v) => ['…'] }],
  oracleRules: [{ id: 'validation-code', evaluate: (input) => ({ status: 'HANDLED', reason: 'X' }) }],
  reporters: [{ id: 'mutations', extension: 'csv', render: (report) => '…' }],
}
```

| Contrat            | Méthodes (toutes **synchrones**)          | Reçoit                                                   | Rend                                                  |
| ------------------ | ----------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| `MutationStrategy` | `supports(input)`, `generate(input, ctx)` | `InputDescriptor` (valeur d'origine déjà masquée), `ctx` | `boolean` ; `[{ op?: 'set' \| 'delete', value }]`     |
| `FormatDetector`   | `detect(value)`, `invalidValues(value)`   | la chaîne d'origine d'une entrée de type `string`        | `boolean` ; `string[]`                                |
| `OracleRule`       | `evaluate(input)`                         | `OracleRuleInput` (mutation, verdict intégré, issue)     | `{ status, reason }` ou `null` (sans avis)            |
| `Reporter`         | `render(report)`                          | le rapport JSON (schéma publié, déjà masqué)             | `string` (écrit dans `<dossier>/<plugin>.<id>.<ext>`) |

- `ctx.limits` : plafonds `stringLength`, `arrayLength`, `objectDepth` (configuration
  `mutations.limits`, elle-même bornée par les limites dures). `ctx.random()` : **seul aléa permis**
  (mulberry32, graine dérivée de la graine du run, du call site, du chemin et de l'identifiant de la
  stratégie : indépendante de l'ordre des entrées).
- Valeur : JSON pur au format étiqueté du protocole (`{ "$t": "undefined" }`, etc.,
  `docs/probe-protocol.md`) ; objets simples, nombres finis.
- Règle d'oracle : `status` ∈ `HANDLED | UNEXPECTED_FAILURE | CRASH | PASSED`, `reason` en
  `[A-Z0-9_]{1,64}`. Elle n'est consultée **que** pour un comportement observé de la cible (jamais
  pour `INFRA_ERROR`, `TIMEOUT`, `SKIPPED`, ni un signal de processus : `RESOURCE_LIMIT`,
  `PROCESS_EXIT`, `UNHANDLED_REJECTION`). La première règle (ordre de chargement) qui rend un avis
  l'emporte ; le résultat garde la trace `reason: RULE:<plugin>/<id>:<REASON>`.
- Rapporteur : `varia report --extensions-dir <dossier>` écrit un fichier par rapporteur.
- `definePlugin(plugin)` (TypeScript) : identité typée.

## Identifiants, ordre, conflits (déterministes)

- Identifiant complet d'une extension : `<name>/<id>` (le `/` ne figure dans aucune stratégie
  intégrée : **aucun conflit possible avec Varia**). C'est le nom de stratégie des mutations, celui
  qu'accepte `--strategy`.
- Deux plugins de même `name` : le **premier** dans la liste gagne, le suivant est refusé
  (`DUPLICATE_ID`). Deux extensions de même `id` dans un plugin (tous types confondus) : la première
  gagne (`DUPLICATE_ID`).
- Ordre d'appel : ordre de la liste, puis, dans un plugin, stratégies, détecteurs, règles,
  rapporteurs, chacun dans l'ordre de déclaration. Les candidats externes s'ajoutent après ceux des
  stratégies intégrées ; une valeur déjà proposée n'est pas dupliquée (la première gagne).

## Version du contrat (`apiVersion`)

`PLUGIN_API_VERSION = 1`. Une extension qui déclare une autre valeur (ou aucune) est **refusée au
chargement** : `API_VERSION_INCOMPATIBLE` (« apiVersion 2 ; cette version de Varia accepte 1 »).
Tout changement incompatible d'un contrat incrémente la version ; un ajout optionnel ne la change
pas.

## Déterminisme et plafonds durs (contrôlés, jamais crus sur parole)

- Chaque stratégie (ou détecteur) est appelée **deux fois** avec les mêmes entrées et graines :
  sorties différentes ⇒ `NON_DETERMINISTIC`.
- `Math.random` est **remplacé pendant l'appel** par une fonction qui lève ; un appel est signalé
  (`MATH_RANDOM_FORBIDDEN`) même si l'extension rattrape l'exception. Non couvert : `crypto`,
  `Date.now()`, l'état du module — la double génération les détecte quand ils changent la sortie.
- Plafonds : longueur de chaîne, de tableau et profondeur au-delà de `ctx.limits`, ou plus de 100
  valeurs pour une entrée ⇒ `LIMIT_EXCEEDED`.
- Forme invalide (pas un tableau, élément non objet, `op` inconnue, valeur absente, non JSON — fonction,
  `Date`, `NaN`…) ⇒ `INVALID_SHAPE`.
- Une stratégie en erreur ne contribue **aucun** candidat (tout ou rien) : le plan reste
  déterministe.

## Erreurs : `PLUGIN_FAILURE` (X-03)

Une extension absente, refusée, qui lève, boucle ou renvoie une forme invalide **ne fait jamais
tomber le run**. L'erreur a l'origine `PLUGIN_FAILURE` (distincte de `PROJECT_FAILURE` : jamais
imputée au projet), l'extension est désactivée pour le run, un avertissement est affiché et le
rapport JSON la consigne (`plugins.failures`, champs `plugin`, `extension`, `phase`, `code`,
`message` borné à 500 caractères).

| Code                       | Phase                  | Cause                                                    |
| -------------------------- | ---------------------- | -------------------------------------------------------- |
| `NOT_FOUND`                | `load`                 | chemin ou paquet introuvable                             |
| `LOAD_ERROR`               | `load`                 | le module lève à l'import (syntaxe, dépendance absente…) |
| `API_VERSION_INCOMPATIBLE` | `load`                 | `apiVersion` ≠ 1                                         |
| `INVALID_SHAPE`            | toutes                 | export, nom, identifiant ou valeur rendue non conforme   |
| `DUPLICATE_ID`             | `load`                 | nom de plugin ou identifiant déjà pris                   |
| `THROWN`                   | `plan` `fuzz` `report` | exception de l'extension                                 |
| `TIMEOUT`                  | toutes                 | aucune réponse dans le délai (boucle, thread mort)       |
| `NON_DETERMINISTIC`        | `plan`                 | deux générations, même graine, sorties différentes       |
| `MATH_RANDOM_FORBIDDEN`    | toutes                 | `Math.random` appelé pendant l'appel                     |
| `LIMIT_EXCEEDED`           | `plan`                 | plafond dur dépassé                                      |

Les erreurs de toutes les commandes d'un run (plan, fuzz, rapport) sont cumulées dans le run. Une
erreur d'un rapporteur survient après la construction du rapport qu'il rend : elle apparaît dans le
rapport **suivant** (et dans l'avertissement immédiat).

### Délai et boucles : conception et ce qui est couvert

Une boucle synchrone infinie ne peut pas être interrompue dans le thread qui l'exécute. Chaque
plugin est donc exécuté dans **un thread** (`worker_threads`) du processus Varia. Varia lui envoie
une requête et l'attend de façon synchrone (`Atomics.wait`) au plus `execution.timeout_ms` ; au-delà,
le thread est arrêté (`worker.terminate()`, qui interrompt aussi une boucle synchrone) et **tout le
plugin** est désactivé (`TIMEOUT`).

- Couvert (testé) : boucle synchrone infinie au chargement ou dans un appel ; exception levée plus
  tard dans le thread (minuterie) : le thread meurt, l'appel suivant est un `TIMEOUT` ; `process.exit`
  dans le thread ne quitte que le thread.
- Le délai vaut pour **un appel** : la génération d'une stratégie sur toutes les entrées du plan, un
  verdict, un rendu.
- Non couvert : la **mémoire** du thread n'est pas bornée (une extension qui épuise le tas peut
  arrêter le processus Varia : `UNVERIFIED`) ; un travail asynchrone lancé par l'extension n'est pas
  attendu (les contrats sont synchrones) ; la sortie standard d'une extension est ignorée (elle ne
  pollue jamais `--json`), sa sortie d'erreur est celle de Varia.

## Modèle de confiance

- Une extension est du **code de l'utilisateur**, exécuté dans le processus Varia **avec ses droits**
  (fichiers, réseau, processus). Le thread sert au délai, **pas** à l'isolation : Varia ne prétend
  offrir aucun bac à sable. N'installez que des extensions dont vous faites confiance à la source.
- Ce que Varia garantit par construction : une extension **ne reçoit jamais** de valeur non masquée
  (entrées et rapports viennent de la base, où la sonde n'écrit que des valeurs redigées ; une entrée
  masquée n'est pas mutable et n'est pas transmise) ; elle **ne reçoit aucun accès à la base** (seul
  l'orchestrateur écrit ; `@varia/plugins` ne dépend ni de `@varia/database` ni du moteur, vérifié par
  `tests/architecture.test.ts`) ; tout ce qu'elle rend est **validé** avant usage.
- Limite connue : le cache des résultats (`cache.enabled`) ne tient pas compte du contenu des règles
  d'oracle externes ; après modification d'une règle, utilisez `--no-cache`.

## Rapport JSON (schéma v4)

```json
"plugins": {
  "loaded": [{ "name": "iban", "specifier": "./iban.mjs", "apiVersion": 1,
               "extensions": [{ "kind": "strategy", "id": "iban/invalid-iban", "disabled": false }] }],
  "failures": [{ "origin": "PLUGIN_FAILURE", "plugin": "boucle", "extension": "boucle/s",
                 "phase": "plan", "code": "TIMEOUT", "message": "aucune réponse en 5000 ms (…)" }]
}
```

## Tester une extension : `@varia/testkit` (T-01)

API stable, indépendante du lanceur de tests (les assertions lèvent une `AssertionError` de Node) :

| Besoin                       | API                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Call sites, entrées, plans   | `callSite({ args, module, export })`, `inputsOf`, `inputAt(call, 'arg0.iban')`, `mutationOf`, `planFor`                   |
| Doubles de sonde             | `probeEvent`, `probe.hello/observeCall/mutateCall/targetReturn/targetThrow/targetReject`, `serializedError`, `adapterRun` |
| Exécuter une mutation        | `runMutation({ target, call, mutation, plugins?, oracle? })` ⇒ `classification`, `events`                                 |
| Assertions de statut         | `assertStatus(classification, 'HANDLED', { reason })`                                                                     |
| Extensions comme en run réel | `withPlugin`, `generateWith`, `checkDeterminism`, `assertDeterministic`, `evaluateRules`, `renderWith`                    |

```ts
import {
  assertDeterministic,
  assertStatus,
  callSite,
  inputAt,
  mutationOf,
  runMutation,
} from '@varia/testkit'

const call = callSite({
  export: 'transfer',
  args: [{ iban: 'FR7630006000011234567890189', token: 's' }],
})
const input = inputAt(call, 'arg0.iban') // `arg0.token` est masqué : non mutable
const candidates = assertDeterministic({
  plugin: './iban.mjs',
  strategy: 'iban/invalid-iban',
  inputs: [input],
})
const r = await runMutation({
  target: transfer,
  call,
  mutation: mutationOf(input, { strategy: 'iban/invalid-iban', value: 'FR00' }),
  plugins: ['./rules.mjs'],
})
assertStatus(r.classification, 'HANDLED', { reason: 'RULE:codes/validation-code:VALIDATION_CODE' })
```

Exemple complet : `tests/j4/plugins-examples.test.ts` (n'importe que `@varia/testkit`) ; run réel :
`tests/j4/plugins-e2e.test.ts`.

## Squelette scaffold (`varia scaffold strategy|rule|reporter`, T-02)

1. `varia scaffold strategy mon-plugin [--dir <dossier>]` (ou `rule`, `reporter`) crée
   `<dossier>/mon-plugin/` (défaut : dossier courant) ; même nom ⇒ mêmes octets, aucune date. Nom :
   minuscules, chiffres, tirets isolés, commençant par une lettre, 30 caractères au plus ; c'est aussi le
   `name` du plugin. Type ou nom invalide, cible non vide ou qui n'est pas un dossier : refus, rien
   n'est écrit, code de sortie 3.
2. `src/index.mjs` : module d'extension `apiVersion: 1` (JavaScript `// @ts-check`, typé par
   `@varia/plugins`) avec une extension d'exemple :
   - `strategy` → `mon-plugin/variants` : variantes d'une chaîne, position tirée par `ctx.random` (RNG
     semé, jamais `Math.random`) ;
   - `rule` → `mon-plugin/invalid-input-code` : erreur de code `E_INVALID_INPUT` ⇒ `HANDLED` ;
   - `reporter` → `mon-plugin/summary` (`.txt`) : nombre de mutations par statut.
3. `test/plugin.test.ts` charge l'extension par `@varia/testkit` (`generateWith` +
   `assertDeterministic`, `evaluateRules` ou `renderWith`) : mêmes chargement et contrôles qu'un run.
4. `npm install`, `npm run typecheck`, `npm test` ; puis déclarer `./…/mon-plugin/src/index.mjs` dans
   `plugins:` de `varia.yml` et remplacer l'extension d'exemple par la vôtre.

Preuve : `tests/j4/scaffold.test.ts` (Prettier, `tsc --noEmit`, `vitest run` sur chaque squelette).
