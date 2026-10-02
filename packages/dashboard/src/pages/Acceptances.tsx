import { useState, type FormEvent } from 'react'
import { getJson, useApi } from '../api.js'
import { Load } from '../components/Common.js'
import { useI18n } from '../i18n.js'

interface Acc {
  id: string
  function: string
  path: string | null
  strategy: string | null
  reason: string
  owner: string | null
  expires: string | null
}

const FIELDS = ['function', 'path', 'strategy', 'reason', 'owner', 'expires'] as const

/** Gestion des acceptations (CDC §21, §26 niveau 2) : jeton local, confirmation en ligne (aucun dialogue natif). */
export function Acceptances() {
  const { t } = useI18n()
  const [version, setVersion] = useState(0)
  const [message, setMessage] = useState<'saved' | 'invalid' | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const list = useApi<Acc[]>(`/api/v1/acceptances?v=${String(version)}`)
  const send = async (method: 'POST' | 'DELETE', url: string, body?: unknown) => {
    const { token } = await getJson<{ token: string }>('/api/v1/session')
    return fetch(url, {
      method,
      headers: {
        'x-varia-token': token,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  }
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const body = Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f))]))
    const res = await send('POST', '/api/v1/acceptances', body)
    setMessage(res.ok ? 'saved' : 'invalid')
    if (res.ok) setVersion((v) => v + 1)
  }
  const remove = async (id: string) => {
    await send('DELETE', `/api/v1/acceptances/${encodeURIComponent(id)}`)
    setPending(null)
    setVersion((v) => v + 1)
  }
  const labels: Record<(typeof FIELDS)[number], string> = {
    function: t('dash.acc.function'),
    path: t('dash.acc.path'),
    strategy: t('dash.acc.strategy'),
    reason: t('dash.acc.reason'),
    owner: t('dash.acc.owner'),
    expires: t('dash.acc.expires'),
  }
  return (
    <section aria-labelledby="acc-title">
      <h1 id="acc-title">{t('dash.acc.title')}</h1>
      <Load value={list}>
        {(items) =>
          items.length === 0 ? (
            <p className="muted">{t('dash.acc.none')}</p>
          ) : (
            <ul className="cards">
              {items.map((a) => (
                <li key={a.id} className="card">
                  <code>
                    {a.function} {a.path ?? '*'} {a.strategy ?? '*'}
                  </code>
                  <span>{a.reason}</span>
                  {a.expires ? <span className="muted">{a.expires}</span> : null}
                  {pending === a.id ? (
                    <>
                      <button type="button" onClick={() => void remove(a.id)}>
                        {t('dash.acc.confirm')}
                      </button>
                      <button type="button" onClick={() => setPending(null)}>
                        {t('dash.acc.cancel')}
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setPending(a.id)}>
                      {t('dash.acc.delete')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </Load>
      <form className="acc-form" onSubmit={(e) => void submit(e)}>
        {FIELDS.map((f) => (
          <label key={f}>
            <span>{labels[f]}</span>
            <input
              name={f}
              required={f === 'function' || f === 'reason'}
              pattern={f === 'expires' ? '\\d{4}-\\d{2}-\\d{2}' : undefined}
            />
          </label>
        ))}
        <button type="submit">{t('dash.acc.add')}</button>
      </form>
      {message !== null ? (
        <p role="status" className={message === 'saved' ? 'callout' : 'error'}>
          {t(message === 'saved' ? 'dash.acc.saved' : 'dash.acc.invalid')}
        </p>
      ) : null}
    </section>
  )
}
