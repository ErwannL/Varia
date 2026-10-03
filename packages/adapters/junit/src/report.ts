import type { TestResult } from '@varia/core'
import { testIdOf } from '@varia/probe-runtime'
import { testFileOf, testNameOf } from './ids.js'

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')

interface Started {
  uniqueId: string
  type: string
  start: number
}

/**
 * Lit le rapport d'événements « Open Test Reporting » de la console JUnit (`junit-platform-events-*.xml`) ;
 * `null` si le rapport est incomplet (processus mort avant la fin : `System.exit`, délai dépassé).
 * Les identités des tests sont celles de la sonde (même nom, même fichier, même rang).
 */
export function parseEventsReport(
  xml: string,
  root: string,
  testRoots: string[],
): TestResult[] | null {
  if (!xml.includes('</e:events>')) return null
  const started = new Map<string, Started>()
  const out: TestResult[] = []
  const counts = new Map<string, number>()
  const add = (s: Started, status: TestResult['status'], end: number | null) => {
    if (s.type !== 'TEST') return
    const name = testNameOf(s.uniqueId)
    const file = testFileOf(name, root, testRoots)
    const key = `${file}\u0000${name}`
    const dup = counts.get(key) ?? 0
    counts.set(key, dup + 1)
    out.push({
      testId: testIdOf(file, name, dup),
      file,
      name,
      status,
      durationMs: end === null ? null : Math.max(0, end - s.start),
    })
  }
  const re =
    /<e:(started|finished|reported) id="(\d+)"[^>]*?time="([^"]+)"[^>]*>([\s\S]*?)<\/e:\1>/g
  for (const m of xml.matchAll(re)) {
    const [, kind, id, time, body] = m as unknown as [string, string, string, string, string]
    const at = Date.parse(time)
    if (kind === 'started' || kind === 'reported') {
      const s: Started = {
        uniqueId: unescape(/<junit:uniqueId>([\s\S]*?)<\/junit:uniqueId>/.exec(body)?.[1] ?? ''),
        type: /<junit:type>([A-Z_]+)<\/junit:type>/.exec(body)?.[1] ?? '',
        start: at,
      }
      if (kind === 'reported') add(s, 'skipped', null)
      else started.set(id, s)
      continue
    }
    const s = started.get(id)
    if (s === undefined) continue
    const status = /<result status="([A-Z]+)"/.exec(body)?.[1]
    add(
      s,
      status === 'SUCCESSFUL'
        ? 'passed'
        : status === 'FAILED'
          ? 'failed'
          : status === 'SKIPPED'
            ? 'skipped'
            : 'other',
      at,
    )
  }
  return out
}
