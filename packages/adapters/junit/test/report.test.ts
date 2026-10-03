import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testIdOf } from '@varia/probe-runtime'
import { describe, expect, it } from 'vitest'
import { parseEventsReport } from '../src/report.js'

const root = mkdtempSync(join(tmpdir(), 'varia-junit-report-'))
const started = (id: number, uid: string, type: string, t: string, parent = '') =>
  `<e:started id="${String(id)}" name="n &amp; m"${parent} time="${t}"><metadata><junit:uniqueId>${uid}</junit:uniqueId><junit:type>${type}</junit:type></metadata></e:started>`
const finished = (id: number, status: string, t: string) =>
  `<e:finished id="${String(id)}" time="${t}"><result status="${status}"></result></e:finished>`
const C = '[engine:junit-jupiter]/[class:a.B]'

describe('rapport d’événements Open Test Reporting', () => {
  it('statuts, durées, rangs des homonymes, conteneurs ignorés', () => {
    const xml = [
      '<?xml version="1.0" ?><e:events>',
      started(1, C, 'CONTAINER', '2026-01-01T00:00:00.000Z'),
      started(2, `${C}/[method:ok()]`, 'TEST', '2026-01-01T00:00:00.000Z', ' parentId="1"'),
      finished(2, 'SUCCESSFUL', '2026-01-01T00:00:00.250Z'),
      started(3, `${C}/[method:ko(java.lang.String)]`, 'TEST', '2026-01-01T00:00:01.000Z'),
      finished(3, 'FAILED', '2026-01-01T00:00:01.000Z'),
      started(4, `${C}/[method:ok()]`, 'TEST', '2026-01-01T00:00:02.000Z'),
      finished(4, 'ABORTED', '2026-01-01T00:00:02.000Z'),
      started(5, `${C}/[method:s()]`, 'TEST', '2026-01-01T00:00:03.000Z'),
      finished(5, 'SKIPPED', '2026-01-01T00:00:03.000Z'),
      `<e:reported id="6" time="2026-01-01T00:00:03.000Z"><metadata><junit:uniqueId>${C}/[method:d()]</junit:uniqueId><junit:type>TEST</junit:type></metadata></e:reported>`,
      finished(9, 'SUCCESSFUL', '2026-01-01T00:00:04.000Z'),
      finished(1, 'SUCCESSFUL', '2026-01-01T00:00:04.000Z'),
      `<e:started id="7" time="2026-01-01T00:00:04.000Z"></e:started>`,
      finished(7, 'SUCCESSFUL', '2026-01-01T00:00:04.000Z'),
      `<e:started id="8" time="2026-01-01T00:00:04.000Z"><metadata><junit:uniqueId>${C}/[method:x(&lt;&gt;&quot;&apos;&#65;)]</junit:uniqueId><junit:type>TEST</junit:type></metadata></e:started>`,
      `<e:finished id="8" time="2026-01-01T00:00:04.000Z"><result></result></e:finished>`,
      '</e:events>',
    ].join('\n')
    const r = parseEventsReport(xml, root, ['src/test/java'])
    const f = 'src/test/java/a/B.java'
    expect(r).toEqual([
      {
        testId: testIdOf(f, 'a.B#ok()', 0),
        file: f,
        name: 'a.B#ok()',
        status: 'passed',
        durationMs: 250,
      },
      {
        testId: testIdOf(f, 'a.B#ko(java.lang.String)', 0),
        file: f,
        name: 'a.B#ko(java.lang.String)',
        status: 'failed',
        durationMs: 0,
      },
      {
        testId: testIdOf(f, 'a.B#ok()', 1),
        file: f,
        name: 'a.B#ok()',
        status: 'other',
        durationMs: 0,
      },
      {
        testId: testIdOf(f, 'a.B#s()', 0),
        file: f,
        name: 'a.B#s()',
        status: 'skipped',
        durationMs: 0,
      },
      {
        testId: testIdOf(f, 'a.B#d()', 0),
        file: f,
        name: 'a.B#d()',
        status: 'skipped',
        durationMs: null,
      },
      {
        testId: testIdOf(f, 'a.B#x(<>"\'A)', 0),
        file: f,
        name: 'a.B#x(<>"\'A)',
        status: 'other',
        durationMs: 0,
      },
    ])
  })

  it('rapport incomplet (processus mort) : null', () => {
    expect(parseEventsReport('<e:events>', root, [])).toBeNull()
  })
})
