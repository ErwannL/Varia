import type { MessageKey } from '@varia/i18n'
import type { Crumb } from '../components/Common.js'

type T = (key: MessageKey, params?: Record<string, string | number>) => string

/** Dossier d'un fichier de test (même règle que l'API : `.` à la racine). */
export const folderOf = (file: string): string => {
  const i = file.lastIndexOf('/')
  return i < 0 ? '.' : file.slice(0, i)
}

/**
 * Fil d'Ariane jusqu'au niveau demandé. Le dernier élément n'a pas de lien (page courante).
 * Les libellés sont traduits AU RENDU (`t` reçu), jamais conservés.
 */
export function trail(
  t: T,
  runId: string,
  at: {
    file?: string
    folder?: string
    test?: { id: string; name: string }
    callSite?: { id: string; target: string }
    mutation?: string
    error?: boolean
  } = {},
): Crumb[] {
  const folder = at.folder ?? (at.file === undefined ? undefined : folderOf(at.file))
  const items: Crumb[] = [
    { label: t('dash.crumb.project'), path: [] },
    { label: t('dash.crumb.run', { id: runId }), path: ['runs', runId] },
    { label: t('dash.nav.folders'), path: ['runs', runId, 'folders'] },
  ]
  if (folder !== undefined)
    items.push({
      label: t('dash.crumb.folder', { name: folder }),
      path: ['runs', runId, 'folders', folder],
    })
  if (at.file !== undefined)
    items.push({
      label: t('dash.crumb.file', { name: at.file }),
      path: ['runs', runId, 'files', at.file],
    })
  if (at.test !== undefined)
    items.push({
      label: t('dash.crumb.test', { name: at.test.name }),
      path: ['runs', runId, 'tests', at.test.id],
    })
  if (at.callSite !== undefined)
    items.push({
      label: t('dash.crumb.callSite', { name: at.callSite.target }),
      path: ['runs', runId, 'call-sites', at.callSite.id],
    })
  if (at.mutation !== undefined)
    items.push({
      label: t('dash.crumb.mutation', { name: at.mutation }),
      path: ['mutations', at.mutation],
      query: { run: runId },
    })
  if (at.error === true) items.push({ label: t('dash.crumb.error') })
  // Page courante : sans lien.
  const last = items[items.length - 1] as Crumb
  items[items.length - 1] = { label: last.label }
  return items
}
