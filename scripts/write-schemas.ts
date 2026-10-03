// Régénère les schémas JSON publiés (outil de développement, hors code livré) :
// packages/config/schema/varia.schema.json, packages/reporters/schema/report.schema.json et un schéma
// par message de sonde dans packages/probe-protocol/schema/ (P-01).
// Des tests vérifient qu'ils sont à jour. Usage : npm run schemas
import { writeFileSync } from 'node:fs'
import { format, resolveConfig } from 'prettier'
import { jsonSchema } from '../packages/config/src/load.js'
import { messageJsonSchemas, schemaFileOf } from '../packages/probe-protocol/src/index.js'
import { reportJsonSchema } from '../packages/reporters/src/schema.js'

const out: [string, unknown][] = [
  ['packages/config/schema/varia.schema.json', jsonSchema()],
  ['packages/reporters/schema/report.schema.json', reportJsonSchema()],
  ...Object.entries(messageJsonSchemas()).map(([type, schema]): [string, unknown] => [
    `packages/probe-protocol/schema/${schemaFileOf(type)}`,
    schema,
  ]),
]
for (const [file, schema] of out) {
  // JSON compact mis en forme par Prettier (épinglé) : les petits objets restent sur une ligne, le
  // fichier reste sous la limite de 1000 lignes. Les tests comparent le CONTENU (JSON analysé).
  // Les schémas de la sonde suivent la configuration Prettier du dépôt (vérifiés par format:check).
  const cfg = file.startsWith('packages/probe-protocol/') ? await resolveConfig(file) : {}
  writeFileSync(file, await format(JSON.stringify(schema), { ...cfg, parser: 'json' }))
  console.log(`écrit : ${file}`)
}
