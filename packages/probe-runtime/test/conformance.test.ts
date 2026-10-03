// P-02 : la sonde JavaScript rejoue TOUT le jeu de conformité du protocole avec sa propre
// implémentation (serialize.cjs, probe.cjs). Une autre sonde (Python, PHP, Java) rejoue les mêmes
// fichiers (packages/probe-protocol/conformance/README.md).
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { build, mismatches, run, type Case, type CaseFile } from './conformance-lib.js'

const casesDir = new URL('../../probe-protocol/conformance/cases/', import.meta.url)
const docs = readdirSync(casesDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => [f, JSON.parse(readFileSync(new URL(f, casesDir), 'utf8')) as CaseFile] as const)
const all: Case[] = docs.flatMap(([, d]) => d.cases)

describe('rejeu du jeu de conformité par la sonde JS (P-02)', () => {
  it('le jeu n’est pas vide et couvre toutes les opérations', () => {
    expect(new Set(all.map((c) => c.op))).toEqual(
      new Set([
        'serialize',
        'serializeArgs',
        'serializeError',
        'testId',
        'callSiteId',
        'canonical',
      ]),
    )
  })
  for (const [file, doc] of docs)
    describe(file, () => {
      it.each(doc.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
        expect(mismatches(run(c), c.expected)).toEqual([])
      })
    })
})

describe('outillage du rejeu', () => {
  it('le comparateur détecte chaque écart', () => {
    expect(mismatches({ a: 1 }, { a: 2 })).toEqual(['$.a : 2 ≠ 1'])
    expect(mismatches({ a: 1, b: 2 }, { a: 1 })).toEqual(['$ : clés en trop ["b"]'])
    expect(mismatches([1], { a: 1 })).toHaveLength(1)
    expect(mismatches([1, 2], [1])).toHaveLength(1)
    expect(mismatches(3, { $match: 'string' })).toHaveLength(1)
    expect(mismatches('x', { $match: 'string' })).toEqual([])
    expect(mismatches(['a'], { $prefix: ['a', 'b'] })).toHaveLength(1)
    expect(mismatches('a', { $prefix: [] })).toHaveLength(1)
    expect(mismatches(['a', 'b', 'c'], { $prefix: ['a', 'b'] })).toEqual([])
    expect(mismatches(-0, 0)).toHaveLength(1)
  })
  it('entrées et opérations inconnues : erreur, jamais une valeur devinée', () => {
    expect(() => build({ $in: 'licorne' })).toThrow(/inconnue/)
    expect(() => run({ id: 'x', op: 'licorne', input: {}, expected: null })).toThrow(/inconnue/)
    expect(() => build({ $in: 'bigint', v: 1 })).toThrow(/chaîne/)
    expect(() => build({ $in: 'string', repeat: 'a', times: 'x' })).toThrow(/nombre/)
    expect(() => build({ $in: 'map', entries: 1 })).toThrow(/tableau/)
  })
})
