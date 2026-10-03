// Jeu de conformité (P-02) : le manifeste lie le contenu des fixtures à une version du protocole. Une
// fixture modifiée sans changer la version (et l'empreinte) du manifeste fait échouer ce test.
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  conformanceDigest,
  PROTOCOL_VERSION_STRING,
  type ConformanceManifest,
} from '../src/index.js'

const dir = new URL('../conformance/', import.meta.url)
const casesDir = new URL('cases/', dir)
const manifest = JSON.parse(
  readFileSync(new URL('manifest.json', dir), 'utf8'),
) as ConformanceManifest
const files = readdirSync(casesDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
const read = (name: string) => readFileSync(new URL(name, casesDir), 'utf8')
const OPS = ['serialize', 'serializeArgs', 'serializeError', 'testId', 'callSiteId', 'canonical']

describe('manifeste de conformité (P-02)', () => {
  it('version du manifeste = version du protocole', () => {
    expect(manifest.protocolVersion).toBe(PROTOCOL_VERSION_STRING)
  })
  it('liste exacte des fichiers de cas', () => {
    expect(manifest.files).toEqual(files)
  })
  it('empreinte sha256 du contenu = celle du manifeste (fixture modifiée ⇒ nouvelle version)', () => {
    expect(conformanceDigest(files.map((name) => ({ name, content: read(name) })))).toBe(
      manifest.sha256,
    )
  })
  it('l’empreinte change au moindre octet, ne dépend pas de l’ordre de lecture', () => {
    const a = { name: 'a.json', content: '{}' }
    const b = { name: 'b.json', content: '[]' }
    const base = conformanceDigest([a, b])
    expect(conformanceDigest([b, a])).toBe(base)
    expect(conformanceDigest([a, { name: 'b.json', content: '[ ]' }])).not.toBe(base)
    expect(conformanceDigest([{ name: 'a.json', content: '{}[]' }])).not.toBe(
      conformanceDigest([{ name: 'a.json{}', content: '[]' }]),
    )
    expect(conformanceDigest([a, a])).toBe(conformanceDigest([a, a]))
  })
  it('chaque cas : identifiant unique, opération connue, entrée et attendu présents', () => {
    const ids = new Set<string>()
    for (const f of files) {
      const doc = JSON.parse(read(f)) as { description: string; cases: Record<string, unknown>[] }
      expect(doc.description.length, f).toBeGreaterThan(0)
      expect(doc.cases.length, f).toBeGreaterThan(0)
      for (const c of doc.cases) {
        expect(ids.has(String(c['id'])), String(c['id'])).toBe(false)
        ids.add(String(c['id']))
        expect(OPS, String(c['id'])).toContain(c['op'])
        expect(Object.keys(c).sort()).toEqual(['expected', 'id', 'input', 'op'])
      }
    }
    expect(ids.size).toBeGreaterThan(50)
  })
})
