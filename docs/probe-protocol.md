# Protocole de la sonde (version 1)

Contrat entre la **sonde** (dans le processus de test) et l'**orchestrateur** (CDC §10.6, §40, D.0).
Implémentation de référence : `packages/probe-runtime/runtime/probe.cjs` ; schéma de validation :
`packages/probe-protocol/src/index.ts` (`parseProbeLog`).

## Entrées (variables d'environnement, aucun réseau)

`VARIA_MODE` (`observe`|`fuzz`), `VARIA_RUN_DIR` (dossier des JSONL), `VARIA_PLAN` (plan JSON, mode
`fuzz`), `VARIA_MUTATION_ID`, `VARIA_TARGETS` (`{ runId, projectRoot }`), `VARIA_REDACT`
(`{ fields, patterns, skipPaths, hmacKey }`).

## Sortie

Un fichier `probe-<pid>.jsonl` par processus, **append-only**, une ligne écrite et vidée par message
(`appendFileSync`) : il survit à `process.exit`. Une ligne tronquée (processus tué) est ignorée et
comptée (`PROBE_TRUNCATED`) ; une ligne hors schéma est comptée (`PROBE_INVALID`).

Champs communs : `protocolVersion` (1), `runId`, `type`, `testId`, `timestamp` (UTC ISO-8601).

| `type`                           | Champs                                                                                                                   | Sens                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `HELLO`                          | `mode`, `pid`, `mutationId`                                                                                              | sonde chargée dans un fichier de test                            |
| `DISCOVER`                       | `module`, `wrapped[]`, `unsupported[]`                                                                                   | exports enveloppés d'un module cible                             |
| `TEST_START` / `TEST_END`        | `file`, `name`                                                                                                           | bornes d'un test                                                 |
| `OBSERVE_CALL`                   | `callId`, `callSiteId`, `module`, `export`, `depth`, `sequence`, `argsFingerprint`, `args` (ou `argsOmitted`), `mutated` | appel d'une target                                               |
| `MUTATE_CALL`                    | `callId`, `callSiteId`, `mutationId`, `applied`, `reason?`                                                               | application (ou refus : `AMBIGUOUS_CALL_SITE`, `PATH_NOT_FOUND`) |
| `TARGET_RETURN`                  | `callId`, `async`, `value`, `durationMs`                                                                                 | retour (ou promesse résolue)                                     |
| `TARGET_THROW` / `TARGET_REJECT` | `callId`, `error`, `durationMs`                                                                                          | levée synchrone / rejet                                          |

## Identités

- `testId = "t_" + sha256(fichier relatif, nom complet résolu, rang d'homonyme)[0:16]`.
- `callSiteId = "c_" + sha256(testId, module, export, depth, sequence)[0:16]`.
- Empreinte d'arguments : SHA-256 de la forme sérialisée **redigée**, clés triées.

## Valeurs

Sérialisation étiquetée (`$t`) : `undefined`, `number` (`NaN`, `±Infinity`, `-0`), `bigint`, `symbol`,
`date`, `regexp`, `map`, `set`, `bytes`, `error`, `hole`, `circular`, `truncated`, `opaque`, `object`
(instance de classe ou clé `$t` échappée). Valeur masquée : `{ "$redacted": true, "fingerprint": hmac, "type" }`.
Erreur : `{ name, message, code?, status?, stack (filtrée), constructorChain }` — jamais d'`instanceof`.
