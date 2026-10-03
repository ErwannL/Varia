// Commande `varia scaffold adapter|strategy|rule|reporter <nom> [--dir <dossier>]` (T-02).
import { EXIT } from '@varia/engine'
import { t, type MessageKey } from '@varia/i18n'
import { NAME_MAX, SCAFFOLD_KINDS, writeScaffold } from '../scaffold/index.js'
import type { Shared } from '../shared.js'

export function registerScaffold(s: Shared): void {
  s.program
    .command('scaffold')
    .description(t(s.locale(), 'cli.cmd.scaffold'))
    .argument('<type>')
    .argument('<name>')
    .option('--dir <dir>')
    .action((kind: string, name: string, o: { dir?: string }) => {
      const p = s.p()
      const r = writeScaffold(kind, name, s.path(o.dir ?? '.'))
      if (!r.ok) {
        p.warn(`cli.scaffold.${r.reason}` as MessageKey, {
          kind,
          name,
          kinds: SCAFFOLD_KINDS.join(', '),
          max: NAME_MAX,
          path: r.path ?? '',
        })
        s.setExit(EXIT.CONFIG)
        return
      }
      if (p.json) p.data({ kind: r.kind, path: r.path, files: r.files })
      p.say('cli.scaffold.created', { kind: r.kind, path: r.path, count: r.files.length })
      p.say('cli.scaffold.next', { path: r.path })
    })
}
