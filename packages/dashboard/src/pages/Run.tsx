import type { MessageKey } from '@varia/i18n'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { getJson, useApi, type Health } from '../api.js'
import { Load } from '../components/Common.js'
import { useI18n } from '../i18n.js'
import { href } from '../router.js'

/** Intervalle de relecture d'un travail en cours. */
export const POLL_MS = 1000

type Kind = 'baseline' | 'quick' | 'complete'
type JobState = 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELED'
interface Job {
  id: string
  kind: Kind
  state: JobState
  exitCode: number | null
  startedAt: string
  finishedAt: string | null
  command: string
  log: string
  logTruncated: boolean
}
interface Jobs {
  info: { name: string; root: string; config: string | null }
  items: Job[]
}

const KINDS: Record<Kind, { title: MessageKey; desc: MessageKey; go: MessageKey }> = {
  baseline: {
    title: 'dash.run.kind.baseline',
    desc: 'dash.run.kind.baseline.desc',
    go: 'dash.run.kind.baseline.go',
  },
  quick: {
    title: 'dash.run.kind.quick',
    desc: 'dash.run.kind.quick.desc',
    go: 'dash.run.kind.quick.go',
  },
  complete: {
    title: 'dash.run.kind.complete',
    desc: 'dash.run.kind.complete.desc',
    go: 'dash.run.kind.complete.go',
  },
}
const STATES: Record<JobState, MessageKey> = {
  RUNNING: 'dash.run.state.RUNNING',
  DONE: 'dash.run.state.DONE',
  FAILED: 'dash.run.state.FAILED',
  CANCELED: 'dash.run.state.CANCELED',
}

/** Jeton local (même origine) puis requête d'écriture ; réponse brute pour que l'appelant lise le code d'erreur. */
async function send(method: 'POST' | 'DELETE', url: string, body?: unknown): Promise<Response> {
  const { token } = await getJson<{ token: string }>('/api/v1/session')
  return fetch(url, {
    method,
    headers: {
      'x-varia-token': token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

/** Entier facultatif d'un champ de formulaire : vide ⇒ absent (le serveur borne et refuse). */
function optionalInt(form: FormData, name: string): Record<string, number> {
  const raw = String(form.get(name) ?? '').trim()
  return raw === '' ? {} : { [name]: Number(raw) }
}

/** Page « Lancer » : opt-in (`varia dashboard --allow-run`), sinon explication de la lecture seule. */
export function Run() {
  const { t } = useI18n()
  const health = useApi<Health>('/health')
  return (
    <section aria-labelledby="run-title">
      <h1 id="run-title">{t('dash.run.title')}</h1>
      <Load value={health}>{(h) => (h.canRun ? <Launcher /> : <Disabled />)}</Load>
    </section>
  )
}

function Disabled() {
  const { t } = useI18n()
  return (
    <>
      <p>{t('dash.run.disabled')}</p>
      <pre className="cmd">{t('dash.run.disabled.start')}</pre>
      <p>{t('dash.run.disabled.alt')}</p>
      <pre className="cmd">{t('dash.run.disabled.cmds')}</pre>
    </>
  )
}

function Launcher() {
  const { t } = useI18n()
  const [jobs, setJobs] = useState<Jobs | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const refresh = useCallback(async () => {
    try {
      setJobs(await getJson<Jobs>('/api/v1/jobs'))
    } catch {
      setError('dash.run.err.unreachable')
    }
  }, [])
  const running = jobs?.items[0]?.state === 'RUNNING'
  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [running, refresh])
  const start = async (kind: Kind, form: FormData) => {
    setError(null)
    const body = {
      kind,
      ...optionalInt(form, 'maxMutations'),
      ...optionalInt(form, 'maxTimeSeconds'),
    }
    const res = await send('POST', '/api/v1/jobs', body)
    if (!res.ok) setError(res.status === 409 ? 'dash.run.err.busy' : 'dash.run.err.invalid')
    await refresh()
  }
  const stop = async (id: string) => {
    await send('DELETE', `/api/v1/jobs/${encodeURIComponent(id)}`)
    await refresh()
  }
  return (
    <>
      <p>{t('dash.run.intro')}</p>
      {jobs === null ? null : (
        <p className="muted">{t('dash.run.project', { name: jobs.info.name })}</p>
      )}
      <div className="run-kinds">
        {(Object.keys(KINDS) as Kind[]).map((kind) => (
          <KindCard key={kind} kind={kind} disabled={running} onStart={start} />
        ))}
      </div>
      {error === null ? null : (
        <p role="alert" className="error">
          {t(error)}
        </p>
      )}
      <h2>{t('dash.run.current')}</h2>
      {jobs === null || jobs.items.length === 0 ? (
        <p className="muted">{t('dash.run.none')}</p>
      ) : (
        <ul className="cards">
          {jobs.items.map((job) => (
            <JobCard key={job.id} job={job} onStop={stop} />
          ))}
        </ul>
      )}
    </>
  )
}

function KindCard({
  kind,
  disabled,
  onStart,
}: {
  kind: Kind
  disabled: boolean
  onStart(kind: Kind, form: FormData): Promise<void>
}) {
  const { t } = useI18n()
  const k = KINDS[kind]
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    void onStart(kind, new FormData(e.currentTarget))
  }
  return (
    <form className="card run-kind" onSubmit={submit}>
      <h2>{t(k.title)}</h2>
      <p>{t(k.desc)}</p>
      {kind === 'baseline' ? null : (
        <>
          <label>
            <span>{t('dash.run.maxMutations')}</span>
            <input name="maxMutations" type="number" min={1} max={100000} inputMode="numeric" />
          </label>
          <label>
            <span>{t('dash.run.maxTime')}</span>
            <input name="maxTimeSeconds" type="number" min={10} max={86400} inputMode="numeric" />
          </label>
        </>
      )}
      <button type="submit" disabled={disabled}>
        {t(k.go)}
      </button>
    </form>
  )
}

function JobCard({ job, onStop }: { job: Job; onStop(id: string): Promise<void> }) {
  const { t } = useI18n()
  const [asking, setAsking] = useState(false)
  const stop = async () => {
    setAsking(false)
    await onStop(job.id)
  }
  return (
    <li className="card run-job">
      <div className="run-job-head">
        <strong>{t(STATES[job.state])}</strong>
        <code>{job.command}</code>
        {job.exitCode === null ? null : (
          <span className="muted">{t('dash.run.exit', { code: job.exitCode })}</span>
        )}
      </div>
      {job.state === 'DONE' && job.exitCode === 1 ? (
        <p className="callout">{t('dash.run.exit.one')}</p>
      ) : null}
      {job.logTruncated ? <p className="muted">{t('dash.run.log.truncated')}</p> : null}
      <pre className="run-log" aria-label={t('dash.run.log')} tabIndex={0}>
        {job.log === '' ? t('dash.run.log.empty') : job.log}
      </pre>
      {job.state === 'RUNNING' ? (
        asking ? (
          <>
            <button type="button" onClick={() => void stop()}>
              {t('dash.run.cancel.confirm')}
            </button>
            <button type="button" onClick={() => setAsking(false)}>
              {t('dash.run.cancel.keep')}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setAsking(true)}>
            {t('dash.run.cancel')}
          </button>
        )
      ) : (
        <a href={href(['runs'])}>{t('dash.run.results')}</a>
      )}
    </li>
  )
}
