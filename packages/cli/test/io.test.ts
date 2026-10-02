// Sorties du CLI : terminal réel (stdout/stderr) et question interactive (`oracle suggest`).
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { processIo, terminalAsk } from '../src/io.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('io', () => {
  it('processIo écrit une ligne sur stdout et stderr', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    processIo.out('a')
    processIo.err('b')
    expect(out).toHaveBeenCalledWith('a\n')
    expect(err).toHaveBeenCalledWith('b\n')
  })
  it('terminalAsk : la question est posée, la réponse lue, l’interface fermée', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const shown: string[] = []
    output.on('data', (c: Buffer) => shown.push(c.toString()))
    const answer = terminalAsk(input, output)('Classer ?')
    input.write('h\n')
    expect(await answer).toBe('h')
    expect(shown.join('')).toContain('Classer ? ')
    // Interface fermée : une seconde question fonctionne sur le même flux.
    const again = terminalAsk(input, output)('Encore ?')
    input.write('c\n')
    expect(await again).toBe('c')
  })
  it('stdin terminal ⇒ processIo pose les questions ; sinon pas de question', async () => {
    const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    try {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
      vi.resetModules()
      expect(typeof (await import('../src/io.js')).processIo.ask).toBe('function')
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
      vi.resetModules()
      expect((await import('../src/io.js')).processIo.ask).toBeUndefined()
    } finally {
      if (tty !== undefined) Object.defineProperty(process.stdin, 'isTTY', tty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
    }
  })
})
