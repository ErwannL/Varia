// Régénère schema/report.schema.json (vérifié par un test).
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { reportJsonSchema } from './schema.js'

writeFileSync(
  fileURLToPath(new URL('../schema/report.schema.json', import.meta.url)),
  JSON.stringify(reportJsonSchema(), null, 2) + '\n',
)
