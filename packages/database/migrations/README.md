# migrations/

Migrations SQL **versionnées** (`NNNN_nom.sql`), appliquées dans l'ordre, chacune dans une
transaction, et enregistrées dans `schema_migrations`. On n'édite jamais une migration publiée : on en
ajoute une nouvelle. Testées par `test/database.test.ts`.
