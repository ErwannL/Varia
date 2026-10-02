import type { AdapterRun } from '@varia/core'

/** Marqueur écrit par la sonde sur stderr quand son journal est inaccessible (probe.cjs). */
export const PROBE_STDERR_MARKER = '[varia] PROBE_ERROR'

/** Erreurs du code de la sonde pendant une exécution (journal, ou marqueur sur stderr). */
export function probeErrorCount(run: AdapterRun): number {
  return (
    run.events.filter((e) => e.type === 'PROBE_ERROR').length +
    run.process.stderr.split(PROBE_STDERR_MARKER).length -
    1
  )
}
