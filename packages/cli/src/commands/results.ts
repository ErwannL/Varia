// Commandes de lecture et de décision : report, compare, accept, oracle suggest (CDC §18.7, §21, §27).
import { applyOracleChoices } from '@varia/config'
import { diffIssues } from '@varia/core'
import { acceptanceStore, EXIT, oracleSuggestions, VariaError } from '@varia/engine'
import { t } from '@varia/i18n'
import { buildReport, reportSchema } from '@varia/reporters'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { acceptanceYaml, configFileOf, type Shared } from '../shared.js'
import { writeOutputs } from './run.js'

export function registerResults(s: Shared): void {
  const { program } = s

  program
    .command('report [runId]')
    .description(t(s.locale(), 'cli.cmd.report'))
    .option('--out <file>')
    .option('--html <file>')
    .option('--junit <file>')
    .option('--sarif <file>')
    .option('--markdown <file>')
    .action(
      (
        runIdArg: string | undefined,
        o: { out?: string; html?: string; junit?: string; sarif?: string; markdown?: string },
      ) =>
        s.withCtx(undefined, (ctx) => {
          const runId = runIdArg ?? ctx.reader.latestRun(ctx.projectId)?.id
          if (runId === undefined)
            throw new VariaError('PROJECT_FAILURE', t(s.p().locale, 'cli.noRun'))
          const report = reportSchema.parse(buildReport(ctx.reader, runId))
          const { out, ...formats } = o
          if (Object.keys(formats).length > 0) {
            writeOutputs(s, ctx, runId, formats)
            return EXIT.OK
          }
          if (out !== undefined) writeFileSync(s.path(out), JSON.stringify(report, null, 2) + '\n')
          else s.io.out(JSON.stringify(report, null, 2))
          return EXIT.OK
        }),
    )

  program
    .command('accept <issueId>')
    .description(t(s.locale(), 'cli.cmd.accept'))
    .requiredOption('--reason <text>')
    .option('--owner <name>')
    .option('--expires <date>')
    .action((issueId: string, o: { reason: string; owner?: string; expires?: string }) =>
      s.withCtx(undefined, (ctx) => {
        const issue = ctx.reader.issue(issueId)
        const occ = ctx.reader
          .issueHistory(issueId)
          .filter((h) => h.count > 0)
          .at(-1)
        if (issue === null || occ === undefined)
          throw new VariaError('PROJECT_FAILURE', `issue inconnue : ${issueId}`)
        const muts = occ.mutationIds
          .map((id) => ctx.reader.mutation(occ.runId, id))
          .filter((m): m is Record<string, unknown> => m !== null)
        const same = (k: string) =>
          muts.length > 0 && muts.every((m) => m[k] === muts[0]?.[k]) ? String(muts[0]?.[k]) : null
        const a = {
          id: `a_${randomBytes(5).toString('hex')}`,
          projectId: ctx.projectId,
          function: issue.target,
          path: same('pathStr'),
          strategy: same('strategy'),
          reason: o.reason,
          owner: o.owner ?? null,
          expires: o.expires ?? null,
        }
        if (acceptanceStore(ctx) === 'file') {
          // Magasin fichier : Varia n'écrit pas varia.yml lui-même ; il donne l'entrée à ajouter.
          s.p().say('cli.accept.file', { file: configFileOf(ctx) })
          s.io.out(acceptanceYaml(a))
          return EXIT.OK
        }
        ctx.writer.addAcceptance(a)
        s.p().say('cli.accept.done', {
          id: a.id,
          function: a.function,
          path: a.path ?? '*',
          strategy: a.strategy ?? '*',
          reason: a.reason,
        })
        return EXIT.OK
      }),
    )

  program
    .command('compare <a> <b>')
    .description(t(s.locale(), 'cli.cmd.compare'))
    .action((a: string, b: string) =>
      s.withCtx(undefined, (ctx) => {
        for (const id of [a, b]) {
          if (ctx.reader.getRun(id) === null)
            throw new VariaError('PROJECT_FAILURE', `run inconnu : ${id}`)
        }
        const counts = (id: string) =>
          ctx.reader
            .issues(id)
            .filter((i) => i.count > 0)
            .map((i) => ({ id: i.id, target: i.target, count: i.count }))
        const d = diffIssues(counts(a), counts(b))
        const p = s.p()
        if (p.json) p.data({ a, b, ...d })
        else {
          p.say('cli.compare.head', { a, b })
          for (const id of d.added) p.say('cli.compare.added', { id })
          for (const id of d.removed) p.say('cli.compare.removed', { id })
          for (const c of d.changed)
            p.say('cli.compare.changed', { id: c.id, before: c.before, after: c.after })
          p.say('cli.compare.summary', {
            added: d.added.length,
            removed: d.removed.length,
            changed: d.changed.length,
            unchanged: d.unchanged.length,
          })
        }
        return EXIT.OK
      }),
    )

  program
    .command('oracle')
    .description(t(s.locale(), 'cli.cmd.oracle'))
    .command('suggest')
    .description(t(s.locale(), 'cli.cmd.oracleSuggest'))
    .action(() =>
      s.withCtx(undefined, async (ctx) => {
        const p = s.p()
        const { runId, items } = oracleSuggestions(ctx)
        if (p.json) {
          p.data({ runId, items })
          return EXIT.OK
        }
        if (items.length === 0) {
          p.say('cli.oracle.none')
          return EXIT.OK
        }
        const ask = s.io.ask
        const handled: string[] = []
        const crash: string[] = []
        for (const item of items) {
          p.say('cli.oracle.item', {
            name: item.errorName,
            count: item.count,
            example: item.example,
          })
          // Sans terminal interactif : la proposition est affichée, rien n'est décidé ni écrit.
          if (ask === undefined) continue
          const answer = (await ask(t(p.locale, 'cli.oracle.question'))).trim().toLowerCase()
          if (answer.startsWith('h')) handled.push(item.errorName)
          else if (answer.startsWith('c')) crash.push(item.errorName)
        }
        if (handled.length + crash.length === 0) {
          p.say('cli.oracle.nothing')
          return EXIT.OK
        }
        const file = configFileOf(ctx)
        const before = existsSync(file) ? readFileSync(file, 'utf8') : ''
        const after = applyOracleChoices(before, { handled, crash })
        s.io.out(after)
        const confirm = (
          await (ask as (q: string) => Promise<string>)(t(p.locale, 'cli.oracle.confirm', { file }))
        )
          .trim()
          .toLowerCase()
        if (confirm === 'y' || confirm === 'o' || confirm === 'yes' || confirm === 'oui') {
          writeFileSync(file, after)
          p.say('cli.oracle.written', { file })
        } else p.say('cli.oracle.notWritten')
        return EXIT.OK
      }),
    )
}
