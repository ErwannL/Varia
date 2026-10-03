import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MESSAGE_TYPES, messageJsonSchemas, schemaFileOf } from '../src/index.js'

const dir = new URL('../schema/', import.meta.url)

describe('JSON Schema publiés (P-01)', () => {
  it('un fichier par message, plus l’union, et rien d’autre', () => {
    const expected = [...MESSAGE_TYPES, 'PROBE_MESSAGE'].map(schemaFileOf)
    expect(
      readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort(),
    ).toEqual(expected.sort())
    expect(schemaFileOf('OBSERVE_CALL')).toBe('observe-call.schema.json')
  })
  it('chaque fichier est égal à la génération depuis le code (npm run schemas)', () => {
    for (const [type, schema] of Object.entries(messageJsonSchemas())) {
      const onDisk = JSON.parse(readFileSync(new URL(schemaFileOf(type), dir), 'utf8')) as unknown
      expect(onDisk, type).toEqual(JSON.parse(JSON.stringify(schema)))
    }
  })
  it('les champs inconnus restent permis (aucun additionalProperties: false)', () => {
    expect(JSON.stringify(messageJsonSchemas())).not.toContain('"additionalProperties":false')
  })
})
