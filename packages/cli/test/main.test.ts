// Point d'entrée du binaire : exécuté pour de vrai (arguments du processus, code de sortie).
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('bin/varia (main.ts)', () => {
  it('lit process.argv, écrit sur stdout, fixe process.exitCode', async () => {
    const argv = process.argv
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    try {
      process.argv = ['node', 'varia', '-q', 'version']
      vi.resetModules()
      await import('../src/main.js')
      expect(out).toHaveBeenCalledWith('0.1.0\n')
      expect(process.exitCode).toBe(0)
      process.argv = ['node', 'varia', 'inconnue']
      vi.resetModules()
      vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      await import('../src/main.js')
      expect(process.exitCode).toBe(3)
    } finally {
      process.argv = argv
    }
  })
  it('dashboard : vrai serveur local (port libre), arrêté par Ctrl+C', async () => {
    const argv = process.argv
    const lines: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
      lines.push(String(c))
      return true
    })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const d = mkdtempSync(join(tmpdir(), 'varia-main-'))
    try {
      process.argv = [
        'node',
        'varia',
        '--data-dir',
        join(d, 'data'),
        '-C',
        d,
        'dashboard',
        '--port',
        '0',
      ]
      vi.resetModules()
      // Ctrl+C simulé dès que le serveur s'annonce, répété jusqu'à l'arrêt (aucune hypothèse sur
      // l'ordre d'enregistrement de l'écouteur ni sur la vitesse de la machine).
      const ctrlC = setInterval(() => {
        // Annonce du serveur, quelle que soit la langue de la machine (« Dashboard : » / « Dashboard: »).
        if (lines.some((l) => /^Dashboard ?: http/.test(l))) process.emit('SIGINT')
      }, 20)
      let timer: NodeJS.Timeout | undefined
      try {
        // Diagnostic : si l'arrêt n'arrive pas, échec rapide avec les sorties capturées.
        await Promise.race([
          import('../src/main.js'),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`dashboard non arrêté ; sorties : ${JSON.stringify(lines)}`)),
              30_000,
            )
          }),
        ])
      } finally {
        clearInterval(ctrlC)
        clearTimeout(timer)
      }
      expect(lines.join('')).toMatch(/^Dashboard ?: http:\/\/127\.0\.0\.1:\d+/m)
      expect(process.exitCode).toBe(0)
    } finally {
      process.argv = argv
    }
  })
})
