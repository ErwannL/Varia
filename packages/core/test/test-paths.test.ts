import { describe, expect, it } from 'vitest'
import { testPaths, type PrepareContext } from '../src/index.js'

const base: PrepareContext = {
  root: '/p',
  tmpDir: '/t',
  runId: 'r',
  include: [],
  exclude: [],
  redact: { fields: [], patterns: [], skipPaths: [], hmacKey: 'k' },
}

describe('testPaths', () => {
  it('absent ⇒ tous les tests (liste vide) ; présent ⇒ tel quel', () => {
    expect(testPaths(base)).toEqual([])
    expect(testPaths({ ...base, paths: ['src/utils'] })).toEqual(['src/utils'])
  })
})
