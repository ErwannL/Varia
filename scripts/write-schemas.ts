// Régénère les schémas JSON publiés (outil de développement, hors code livré) :
// packages/config/schema/varia.schema.json et packages/reporters/schema/report.schema.json.
// Des tests vérifient qu'ils sont à jour. Usage : npm run schemas
import { writeFileSync } from 'node:fs'
import { format } from 'prettier'
import { jsonSchema } from '../packages/config/src/load.js'
import { reportJsonSchema } from '../packages/reporters/src/schema.js'

const out: [string, unknown][] = [
  ['packages/config/schema/varia.schema.json', jsonSchema()],
  ['packages/reporters/schema/report.schema.json', reportJsonSchema()],
]
for (const [file, schema] of out) {
  // JSON compact mis en forme par Prettier (épinglé) : les petits objets restent sur une ligne, le
  // fichier reste sous la limite de 1000 lignes. Les tests comparent le CONTENU (JSON analysé).
  writeFileSync(file, await format(JSON.stringify(schema), { parser: 'json' }))
  console.log(`écrit : ${file}`)
}
