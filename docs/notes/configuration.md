# Configuration : accepté = implémenté (J3)

- Toute valeur de configuration ACCEPTÉE par le schéma est lue et a un effet testé. Une valeur prévue
  par la spécification mais non implémentée est REFUSÉE à la validation (exit 3) par un code stable
  (`unsupported('UNSUPPORTED_…')` dans `packages/config/src/schema.ts`), traduit à l'affichage
  (`config.issue.<CODE>` dans les catalogues i18n, `configIssue`).
- Ajouter une option = ajouter son effet ET un test qui échoue sans lui (cas de `mutation-cases.json`).
- Avant d'accepter une nouvelle valeur d'énumération, vérifier qu'elle est lue : `grep` de la clé hors
  `schema.ts` (l'audit J3 a trouvé `test.env`, `test.cwd`, `test.command`, `reset.*` jamais lus).
