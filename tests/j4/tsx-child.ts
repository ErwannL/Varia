// Processus Varia enfant exécutant un script TypeScript du dépôt, tué par SIGKILL dans les scénarios
// de reprise (14). Le chargeur de tsx est importé DANS le processus lancé (`node --import`) : la CLI de
// tsx démarrerait un petit-enfant Node qui survivrait au SIGKILL de son parent et continuerait à
// écrire des résultats pendant la reprise (vu en CI macOS, docs/notes/tests-deterministes.md).
// `process.execPath` et une URL `file:` : `node_modules/.bin/tsx` n'existe pas sous Windows.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Arguments de `spawn(process.execPath, …)` pour exécuter `script` (et ses arguments) en un processus. */
export function tsxArgs(script: string, ...args: string[]): string[] {
  return [
    '--import',
    pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href,
    script,
    ...args,
  ]
}

/** Environnement de l'enfant : tsconfig du dépôt (alias `@varia/*`). */
export function tsxEnv(): NodeJS.ProcessEnv {
  return { ...process.env, TSX_TSCONFIG_PATH: resolve('tsconfig.json') }
}
