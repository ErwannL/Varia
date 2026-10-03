import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Décodage `%XX` (UTF-8) des segments d'identifiant unique JUnit ; un `%` isolé reste tel quel. */
export function decodeSegment(s: string): string {
  return s.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = Buffer.from(run.replace(/%/g, ''), 'hex')
    return bytes.toString('utf8')
  })
}

/**
 * Nom Varia d'un test JUnit, dérivé de son identifiant unique (même règle que la sonde Java,
 * `Targets.testName`) : `<classe>#<méthode>(<types>)` puis ` [n]` par invocation (paramétré,
 * dynamique) ; identifiant non Jupiter ⇒ l'identifiant lui-même.
 */
export function testNameOf(uniqueId: string): string {
  let cls: string | null = null
  let method: string | null = null
  let suffix = ''
  for (const seg of uniqueId.split('/')) {
    const colon = seg.indexOf(':')
    if (!seg.startsWith('[') || !seg.endsWith(']') || colon < 0) return uniqueId
    const type = seg.slice(1, colon)
    const value = decodeSegment(seg.slice(colon + 1, -1))
    if (type === 'class') cls = value
    else if (type === 'nested-class') cls = `${String(cls)}$${value}`
    else if (type === 'method' || type === 'test-template' || type === 'test-factory')
      method = value
    else if (['test-template-invocation', 'dynamic-test', 'dynamic-container'].includes(type))
      suffix += ` [${value.replace(/#/g, '')}]`
  }
  if (cls === null || method === null) return uniqueId
  return `${cls}#${method}${suffix}`
}

/** Fichier source (relatif, POSIX) d'un test : première racine de tests où il existe. */
export function testFileOf(name: string, root: string, testRoots: string[]): string {
  const hash = name.indexOf('#')
  if (hash < 0) return ''
  const cls = name.slice(0, hash).split('$')[0] as string
  const rel = `${cls.replace(/\./g, '/')}.java`
  const found = testRoots.find((r) => existsSync(join(root, r, rel)))
  return `${found ?? testRoots[0] ?? 'src/test/java'}/${rel}`
}

/**
 * Sélecteurs de la console JUnit pour UN test Varia : `--select-method` ; une invocation unique d'un
 * test paramétré : `--select-iteration` (indice à partir de 0). Nom non Jupiter : `--select-unique-id`.
 */
export function selectorsFor(name: string): string[] {
  const m = /^([^#]+)#(.+?\))((?: \[\d+\])*)$/.exec(name)
  if (m === null) return [`--select-unique-id=${name}`]
  const method = `${m[1] as string}#${m[2] as string}`
  const indices = [...(m[3] as string).matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]))
  if (indices.length === 1)
    return [`--select-iteration=method:${method}[${String((indices[0] as number) - 1)}]`]
  return [`--select-method=${method}`]
}
