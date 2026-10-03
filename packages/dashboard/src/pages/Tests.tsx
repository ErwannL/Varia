import { useApi } from '../api.js'
import { Breadcrumbs, failuresOf, Load, Pager } from '../components/Common.js'
import { useI18n } from '../i18n.js'
import { href, usePaging } from '../router.js'
import type { Page } from '../types.js'
import { trail } from './Trail.js'

export interface NodeCounts {
  mutations: number
  crashes: number
  timeouts: number
  unexpected: number
}
export interface TestRow {
  testId: string
  file: string
  folder: string
  name: string
  status: string
  flaky: boolean
  callSites: number
  counts: NodeCounts
}
interface FolderRow {
  folder: string
  files: number
  tests: number
  counts: NodeCounts
}
interface FileRow {
  file: string
  folder: string
  tests: number
  counts: NodeCounts
}

const LIMIT = 50
const base = (runId: string) => `/api/v1/runs/${encodeURIComponent(runId)}`
const qs = (o: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(o)
      .filter((e): e is [string, string | number] => e[1] !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString()

/** En-têtes de colonnes communs aux nœuds de l'arbre : mutations et défaillances. */
function CountCells({ c }: { c: NodeCounts }) {
  return (
    <>
      <td>{c.mutations}</td>
      <td>{failuresOf(c)}</td>
    </>
  )
}
function CountHeads() {
  const { t } = useI18n()
  return (
    <>
      <th scope="col">{t('dash.col.mutations')}</th>
      <th scope="col">{t('dash.col.failures')}</th>
    </>
  )
}

/** Niveau Dossier de l'arbre (paginé côté serveur, page dans l'URL). */
export function Folders({ runId }: { runId: string }) {
  const { t } = useI18n()
  const pg = usePaging(LIMIT)
  const data = useApi<Page<FolderRow>>(
    `${base(runId)}/folders?${qs({ limit: pg.limit, offset: pg.offset })}`,
  )
  return (
    <section aria-labelledby="folders-title">
      <Breadcrumbs items={trail(t, runId)} />
      <h1 id="folders-title">{t('dash.folders.title')}</h1>
      <Load value={data}>
        {(p) => (
          <>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('dash.col.folder')}</th>
                  <th scope="col">{t('dash.col.files')}</th>
                  <th scope="col">{t('dash.col.tests')}</th>
                  <CountHeads />
                </tr>
              </thead>
              <tbody>
                {p.items.map((f) => (
                  <tr key={f.folder}>
                    <td>
                      <a href={href(['runs', runId, 'folders', f.folder])}>
                        <code>{f.folder}</code>
                      </a>
                    </td>
                    <td>{f.files}</td>
                    <td>{f.tests}</td>
                    <CountCells c={f.counts} />
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager total={p.total} limit={p.limit} offset={p.offset} onChange={pg.go} />
          </>
        )}
      </Load>
    </section>
  )
}

/** Niveau Fichier : fichiers d'un dossier. */
export function Files({ runId, folder }: { runId: string; folder: string }) {
  const { t } = useI18n()
  const pg = usePaging(LIMIT)
  const data = useApi<Page<FileRow>>(
    `${base(runId)}/files?${qs({ folder, limit: pg.limit, offset: pg.offset })}`,
  )
  return (
    <section aria-labelledby="files-title">
      <Breadcrumbs items={trail(t, runId, { folder })} />
      <h1 id="files-title">{t('dash.files.title', { folder })}</h1>
      <Load value={data}>
        {(p) => (
          <>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('dash.col.file')}</th>
                  <th scope="col">{t('dash.col.tests')}</th>
                  <CountHeads />
                </tr>
              </thead>
              <tbody>
                {p.items.map((f) => (
                  <tr key={f.file}>
                    <td>
                      <a href={href(['runs', runId, 'files', f.file])}>
                        <code>{f.file}</code>
                      </a>
                    </td>
                    <td>{f.tests}</td>
                    <CountCells c={f.counts} />
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager total={p.total} limit={p.limit} offset={p.offset} onChange={pg.go} />
          </>
        )}
      </Load>
    </section>
  )
}

/** Niveau Test : tests du run, d'un dossier ou d'un fichier (filtres et page dans l'URL). */
export function Tests({
  runId,
  file,
  folder,
}: {
  runId: string
  file?: string | null
  folder?: string | null
}) {
  const { t } = useI18n()
  const pg = usePaging(LIMIT)
  const data = useApi<Page<TestRow>>(
    `${base(runId)}/tests?${qs({ file: file ?? undefined, folder: folder ?? undefined, limit: pg.limit, offset: pg.offset })}`,
  )
  return (
    <section aria-labelledby="tests-title">
      <Breadcrumbs
        items={trail(t, runId, {
          ...(file ? { file } : {}),
          ...(folder ? { folder } : {}),
        })}
      />
      <h1 id="tests-title">
        {file ? t('dash.files.testsTitle', { file }) : t('dash.tests.title')}
      </h1>
      <Load value={data}>
        {(p) => (
          <>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('dash.col.test')}</th>
                  <th scope="col">{t('dash.col.file')}</th>
                  <th scope="col">{t('dash.col.status')}</th>
                  <th scope="col">{t('dash.col.callSites')}</th>
                  <CountHeads />
                </tr>
              </thead>
              <tbody>
                {p.items.map((x) => (
                  <tr key={x.testId}>
                    <td>
                      <a href={href(['runs', runId, 'tests', x.testId])}>{x.name}</a>
                    </td>
                    <td>
                      <code>{x.file}</code>
                    </td>
                    <td>
                      {x.status}
                      {x.flaky ? ` (${t('dash.tests.flaky')})` : ''}
                    </td>
                    <td>{x.callSites}</td>
                    <CountCells c={x.counts} />
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager total={p.total} limit={p.limit} offset={p.offset} onChange={pg.go} />
          </>
        )}
      </Load>
    </section>
  )
}
