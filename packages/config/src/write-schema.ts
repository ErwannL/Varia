// Régénère schema/varia.schema.json (npm run schema). Un test vérifie qu'il est à jour.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { jsonSchema } from './load.js'

const target = fileURLToPath(new URL('../schema/varia.schema.json', import.meta.url))
writeFileSync(target, JSON.stringify(jsonSchema(), null, 2) + '\n')
console.log(`écrit : ${target}`)
