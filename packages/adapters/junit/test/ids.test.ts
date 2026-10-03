import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeSegment, selectorsFor, testFileOf, testNameOf } from '../src/ids.js'

const BASE = '[engine:junit-jupiter]/[class:a.B]'

describe('identités des tests JUnit (mêmes règles que la sonde Java)', () => {
  it('nom dérivé de l’identifiant unique', () => {
    expect(testNameOf(`${BASE}/[method:m()]`)).toBe('a.B#m()')
    expect(testNameOf(`${BASE}/[nested-class:C]/[method:m(int)]`)).toBe('a.B$C#m(int)')
    expect(testNameOf(`${BASE}/[test-template:p(int)]/[test-template-invocation:#2]`)).toBe(
      'a.B#p(int) [2]',
    )
    expect(testNameOf(`${BASE}/[test-factory:f()]/[dynamic-container:#1]/[dynamic-test:#3]`)).toBe(
      'a.B#f() [1] [3]',
    )
    expect(testNameOf(`${BASE}/[method:m(int%5B%5D)]`)).toBe('a.B#m(int[])')
    expect(testNameOf('[engine:x]/[suite:s]')).toBe('[engine:x]/[suite:s]')
    expect(testNameOf(BASE)).toBe(BASE)
    expect(testNameOf('[engine:x]/[nested-class:C]/[method:m()]')).toBe('null$C#m()')
    for (const raw of ['pas-un-id', '[engine:x]/y]', '[engine:x]/[y]', '[engine:x]/[y:z'])
      expect(testNameOf(raw)).toBe(raw)
    expect(decodeSegment('%C3%A9%zz%4')).toBe('é%zz%4')
  })

  it('fichier : première racine où le source existe', () => {
    const root = mkdtempSync(join(tmpdir(), 'varia-junit-ids-'))
    expect(testFileOf('a.B$C#m()', root, [])).toBe('src/test/java/a/B.java')
    expect(testFileOf('[engine:x]', root, ['t'])).toBe('')
    mkdirSync(join(root, 't2', 'a'), { recursive: true })
    writeFileSync(join(root, 't2', 'a', 'B.java'), '')
    expect(testFileOf('a.B#m()', root, ['t1', 't2'])).toBe('t2/a/B.java')
    expect(testFileOf('a.X#m()', root, ['t1', 't2'])).toBe('t1/a/X.java')
  })

  it('sélecteurs de la console : méthode, itération (base 0), identifiant', () => {
    expect(selectorsFor('a.B#m()')).toEqual(['--select-method=a.B#m()'])
    expect(selectorsFor('a.B#p(java.lang.String, int) [2]')).toEqual([
      '--select-iteration=method:a.B#p(java.lang.String, int)[1]',
    ])
    expect(selectorsFor('a.B#f() [1] [3]')).toEqual(['--select-method=a.B#f()'])
    expect(selectorsFor('[engine:x]/[suite:s]')).toEqual([
      '--select-unique-id=[engine:x]/[suite:s]',
    ])
  })
})
