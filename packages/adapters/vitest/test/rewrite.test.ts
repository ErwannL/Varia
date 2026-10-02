import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// Chargé par Node (require d'un module ESM), jamais par Vite : mesure de couverture fiable.
const { rewriteExports } = createRequire(import.meta.url)(
  '../runtime/rewrite.mjs',
) as typeof import('../runtime/rewrite.mjs')

const run = (code: string, file = 'src/m.ts') => rewriteExports(code, file, 'src/m.ts')

describe('réécriture des exports ESM (plugin Vitest)', () => {
  it('fonctions, fonctions async, const, liste, défaut nommé', () => {
    const out = run(
      [
        'export function a(x: number) { return b(x) }',
        'export async function c() { return 1 }',
        'export const d = (y: string) => y',
        'function e() {}',
        'const f = 2',
        'export { e, f as g }',
        'export default function h() {}',
      ].join('\n'),
    )
    expect(out?.exports).toEqual(['a', 'c', 'd', 'e', 'g', 'default'])
    const code = out?.code ?? ''
    expect(code).toContain('function a(x: number) { return b(x) }')
    expect(code).not.toMatch(/^export function/m)
    expect(code).toContain('const __varia_e0 = __varia_w(a, "a");')
    expect(code).toContain(
      'export { __varia_e0 as a, __varia_e1 as c, __varia_e2 as d, __varia_e3 as e, __varia_e4 as g, __varia_e5 as default };',
    )
    expect(code).toContain('wrapExport(f, "src/m.ts", n)')
  })
  it('types, interfaces, let, classes, ré-exports et déclarations ambiantes intacts', () => {
    const src = [
      'export type T = number',
      'export interface I {}',
      'export let l = 1',
      'export class K {}',
      "export { x } from './x'",
      'export declare function z(): void',
      'type U = 1',
      'export { type U }',
    ].join('\n')
    expect(run(src)).toBeNull()
  })
  it('liste mêlant types et valeurs : seules les valeurs sont enveloppées', () => {
    const out = run(['type T = 1', 'function v() {}', 'export { T, v }'].join('\n'))
    expect(out?.exports).toEqual(['v'])
    expect(out?.code).toContain('export { T }')
  })
  it('const déstructurée : laissée telle quelle', () => {
    expect(run('export const { a, b } = obj')).toBeNull()
  })
  it('source map générée, JavaScript et TSX acceptés', () => {
    expect(run('export function a() {}', 'src/m.js')?.map.mappings.length).toBeGreaterThan(0)
    expect(run('export const C = () => <div />', 'src/m.tsx')?.exports).toEqual(['C'])
    expect(run('export const J = () => <p />', 'src/m.jsx')?.exports).toEqual(['J'])
  })
  it('instructions sans modificateurs (appels, conditions) ignorées', () => {
    const out = run('setup()\nif (x) y()\nexport function z() {}')
    expect(out?.exports).toEqual(['z'])
    expect(out?.code.startsWith('setup()')).toBe(true)
  })
  it('surcharges TypeScript : seule l’implémentation est enveloppée', () => {
    const out = run(
      [
        'export function o(a: string): string',
        'export function o(a: number): number',
        'export function o(a: any) { return a }',
      ].join('\n'),
    )
    expect(out?.exports).toEqual(['o'])
  })
})
