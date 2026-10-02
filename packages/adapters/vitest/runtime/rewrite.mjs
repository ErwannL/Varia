// @ts-check
// Réécriture des exports d'un module ESM (CDC §10.0, mécanisme Vitest de J2) : chaque export
// fonction (déclaration `export function`, `export const`, liste `export { … }`) est réexporté
// enveloppé par la sonde. Les appels INTERNES au module restent directs (limite assumée, §10.0-1).
import MagicString from 'magic-string'
import ts from 'typescript'

/** @param {string} filename */
function kindOf(filename) {
  if (/\.tsx$/.test(filename)) return ts.ScriptKind.TSX
  if (/\.[cm]?ts$/.test(filename)) return ts.ScriptKind.TS
  if (/\.jsx$/.test(filename)) return ts.ScriptKind.JSX
  return ts.ScriptKind.JS
}

/** @param {ts.Node} node @param {ts.SyntaxKind} kind */
const has = (node, kind) =>
  ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []).some((m) => m.kind === kind) : false

/**
 * @param {string} code source du module (TypeScript ou JavaScript)
 * @param {string} filename chemin (pour le type de source et la source map)
 * @param {string} moduleId identifiant stable (chemin relatif au projet)
 * @returns {{ code: string, map: import('magic-string').SourceMap, exports: string[] } | null}
 */
export function rewriteExports(code, filename, moduleId) {
  const sf = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, kindOf(filename))
  const s = new MagicString(code)
  /** @type {[string, string][]} [nom local, nom exporté] */
  const wrapped = []
  /** Valeurs (fonctions, constantes) déclarées au niveau du module. */
  const values = new Set()
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) values.add(st.name.text)
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name)) values.add(d.name.text)
  }
  /** Supprime les mots-clés `export` / `default` d'une déclaration. @param {ts.Node} node */
  // Appelée seulement sur une déclaration exportée : elle porte donc des modificateurs.
  const dropExport = (node) => {
    const modifiers = /** @type {readonly ts.Modifier[]} */ (
      ts.getModifiers(/** @type {ts.HasModifiers} */ (node))
    )
    for (const m of modifiers) {
      if (m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword)
        s.remove(m.getStart(sf), m.getEnd() + 1)
    }
  }
  for (const st of sf.statements) {
    if (has(st, ts.SyntaxKind.DeclareKeyword)) continue
    const exported = has(st, ts.SyntaxKind.ExportKeyword)
    const isDefault = has(st, ts.SyntaxKind.DefaultKeyword)
    if (exported && ts.isFunctionDeclaration(st) && st.name) {
      dropExport(st)
      if (st.body) wrapped.push([st.name.text, isDefault ? 'default' : st.name.text])
    } else if (
      exported &&
      !isDefault &&
      ts.isVariableStatement(st) &&
      (st.declarationList.flags & ts.NodeFlags.Const) !== 0
    ) {
      const names = st.declarationList.declarations
        .filter((d) => ts.isIdentifier(d.name))
        .map((d) => /** @type {ts.Identifier} */ (d.name).text)
      if (names.length !== st.declarationList.declarations.length) continue
      dropExport(st)
      for (const n of names) wrapped.push([n, n])
    } else if (
      ts.isExportDeclaration(st) &&
      !st.moduleSpecifier &&
      !st.isTypeOnly &&
      st.exportClause &&
      ts.isNamedExports(st.exportClause)
    ) {
      const keep = []
      for (const el of st.exportClause.elements) {
        const local = (el.propertyName ?? el.name).text
        if (!el.isTypeOnly && values.has(local)) wrapped.push([local, el.name.text])
        else keep.push(el.getText(sf))
      }
      s.overwrite(
        st.getStart(sf),
        st.getEnd(),
        keep.length > 0 ? `export { ${keep.join(', ')} }` : '',
      )
    }
  }
  if (wrapped.length === 0) return null
  const id = JSON.stringify(moduleId)
  let footer = `\n;const __varia_v = globalThis.__varia;\nconst __varia_w = (f, n) => (__varia_v && typeof __varia_v.wrapExport === 'function' ? __varia_v.wrapExport(f, ${id}, n) : f);\n`
  wrapped.forEach(([local, name], i) => {
    footer += `const __varia_e${String(i)} = __varia_w(${local}, ${JSON.stringify(name)});\n`
  })
  footer += `export { ${wrapped.map(([, name], i) => `__varia_e${String(i)} as ${name}`).join(', ')} };\n`
  s.append(footer)
  return {
    code: s.toString(),
    map: s.generateMap({ hires: true, source: filename, includeContent: true }),
    exports: wrapped.map(([, n]) => n),
  }
}
