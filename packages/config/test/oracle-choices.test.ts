// CDC §18.7 : `oracle suggest` écrit des listes (jamais des tables) et conserve l'existant.
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { applyOracleChoices } from '../src/index.js'

describe('applyOracleChoices', () => {
  it('fichier vide : listes créées', () => {
    const y = parse(applyOracleChoices('', { handled: ['A'], crash: ['B'] })) as {
      oracle: { handled_errors: unknown; crash_errors: unknown }
    }
    expect(y.oracle.handled_errors).toEqual([{ name: 'A' }])
    expect(y.oracle.crash_errors).toEqual(['TypeError', 'ReferenceError', 'RangeError', 'B'])
  })
  it('listes existantes : complétées sans doublon, commentaire conservé', () => {
    const before =
      'version: 1\n# garde\noracle:\n  handled_errors:\n    - name: A\n  crash_errors: [X]\n'
    const out = applyOracleChoices(before, { handled: ['A', 'C'], crash: ['X', 'Y'] })
    expect(out).toContain('# garde')
    const y = parse(out) as { oracle: { handled_errors: unknown; crash_errors: unknown } }
    expect(y.oracle.handled_errors).toEqual([{ name: 'A' }, { name: 'C' }])
    expect(y.oracle.crash_errors).toEqual(['X', 'Y'])
  })
  it('aucun choix : texte inchangé', () => {
    expect(applyOracleChoices('version: 1\n', { handled: [], crash: [] })).toBe('version: 1\n')
  })
})
