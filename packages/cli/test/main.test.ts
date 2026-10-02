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
      if (String(c).startsWith('Dashboard :')) setTimeout(() => process.emit('SIGINT'), 10)
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
      await import('../src/main.js')
      expect(lines.join('')).toMatch(/^Dashboard : http:\/\/127\.0\.0\.1:\d+/m)
      expect(process.exitCode).toBe(0)
    } finally {
      process.argv = argv
    }
  })
})
