import type { AdapterRun } from '@varia/core'
import { describe, expect, it } from 'vitest'
import { PROBE_STDERR_MARKER, probeErrorCount } from '../src/signals.js'

const run = (types: string[], stderr = ''): AdapterRun =>
  ({ events: types.map((type) => ({ type })), process: { stderr } }) as unknown as AdapterRun

describe('erreurs de la sonde (A-05)', () => {
  it('compte les PROBE_ERROR du journal et les marqueurs écrits sur stderr', () => {
    expect(probeErrorCount(run(['HELLO', 'OBSERVE_CALL']))).toBe(0)
    expect(probeErrorCount(run(['PROBE_ERROR', 'HELLO', 'PROBE_ERROR']))).toBe(2)
    expect(
      probeErrorCount(
        run([], `x\n${PROBE_STDERR_MARKER} prepare\n${PROBE_STDERR_MARKER} outcome\n`),
      ),
    ).toBe(2)
  })
})
