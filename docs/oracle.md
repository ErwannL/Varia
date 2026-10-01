# Oracle

Ordre d'évaluation (CDC §18.3) : infrastructure (`INFRA_ERROR`) → timeout (`TIMEOUT`) → ressources
(`CRASH/RESOURCE_LIMIT`) → sortie anormale (`CRASH/PROCESS_EXIT`) → mutation non appliquée
(`SKIPPED` : `AMBIGUOUS_CALL_SITE`, `PATH_NOT_FOUND`, `NOT_REACHED`) → erreur de la cible (`HANDLED`
si une règle `handled_errors` correspond, `CRASH` pour `TypeError`/`ReferenceError`/`RangeError`, sinon
`UNEXPECTED_FAILURE` ; `DEPENDENCY_ERROR` si le premier cadre est dans `node_modules`) → retour normal
(`PASSED`, promu `SUSPICIOUS_ACCEPT` uniquement pour `HINT_VIOLATION` ou `ECHO`). Le statut du test
est enregistré mais n'est **jamais** utilisé pour classer. Les erreurs sont jugées par leur
`constructorChain`, jamais par `instanceof`.
