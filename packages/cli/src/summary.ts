import type { Report } from '@varia/reporters'
import { issueTitle } from '@varia/i18n'
import type { Printer } from './io.js'

/** Résumé de fin de run (annexe C) : comptes bruts d'abord, issues, ce qui n'a PAS été testé. */
export function printSummary(p: Printer, r: Report, exitCode: number): void {
  const c = r.counts
  const executed = c.mutations - c.pending
  p.say('cli.summary.executed', {
    planned: c.mutations,
    executed,
    skipped: c.skipped,
    pending: c.pending,
  })
  p.say('cli.summary.counts', {
    handled: c.handled,
    expected: c.expected,
    passed: c.passed,
    suspicious: c.suspicious,
    unexpected: c.unexpected,
  })
  p.say('cli.summary.crashes', {
    crashes: c.crashes,
    timeouts: c.timeouts,
    skipped: c.skipped,
    infra: c.infra,
    pending: c.pending,
  })
  p.say('cli.summary.issues', { count: r.issues.length })
  for (const i of r.issues)
    p.say('cli.summary.issue', {
      severity: i.severity,
      title: issueTitle(p.locale, i),
      count: i.count,
      replay: i.replay,
    })
  const nc = r.notCovered
  p.say('cli.summary.notCovered', {
    never: nc.neverCalled.length,
    unsupported: nc.unsupported.length,
    nonMutable: nc.nonMutableInputs.length,
    flaky: nc.flakyTests.length,
  })
  p.say('cli.summary.limits')
  p.say('cli.summary.run', { runId: r.run.id })
  p.say('cli.summary.exit', { code: exitCode })
}

/** Politique de sortie (CDC §27-28) : 1 si un statut de `ci.fail_on` est présent, sinon 0. */
export function resilienceExit(r: Report, failOn: string[]): number {
  const statuses = new Set(
    r.mutations.map((m) => (m.subtype === 'SUSPICIOUS_ACCEPT' ? 'SUSPICIOUS_ACCEPT' : m.status)),
  )
  return failOn.some((s) => statuses.has(s)) ? 1 : 0
}
