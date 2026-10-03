// Intégration des extensions dans le moteur (J4 X-02, X-03) : session par contexte, chemins relatifs au
// fichier de configuration, avertissements PLUGIN_FAILURE, consignation dans le run.
import type { Classification, PlannedMutation, TestAdapter } from '@varia/core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyPluginRules,
  EngineContext,
  pluginSession,
  recordPlugins,
  type ProgressEvent,
} from '../src/index.js'

const adapter = { id: 'fake' } as TestAdapter

function context(config: string | null) {
  const root = mkdtempSync(join(tmpdir(), 'varia-plugins-'))
  if (config !== null) writeFileSync(join(root, 'varia.yml'), config)
  writeFileSync(
    join(root, 'ext.mjs'),
    "export default { apiVersion: 1, name: 'ext', oracleRules: [{ id: 'r', evaluate: () => { throw new Error('x') } }] }",
  )
  const events: ProgressEvent[] = []
  const ctx = new EngineContext({
    root,
    adapter,
    dataDir: mkdtempSync(join(tmpdir(), 'varia-plugins-data-')),
    onProgress: (e) => events.push(e),
  })
  return { ctx, events }
}

const M = {
  id: 'm',
  module: 'a',
  export: 'b',
  pathStr: 'arg0',
  strategy: 's',
  op: 'set',
} as PlannedMutation
const CALL = { callId: 1, outcome: { kind: 'return', async: false } } as never
const C: Classification = { status: 'PASSED', testStatus: 'passed' }

describe('extensions dans le moteur', () => {
  it('sans fichier de configuration ni extension : session vide, rien consigné', () => {
    const { ctx } = context(null)
    try {
      expect(pluginSession(ctx).summary()).toEqual({ loaded: [], failures: [] })
      expect(pluginSession(ctx)).toBe(pluginSession(ctx))
      expect(applyPluginRules(ctx, M, C, CALL)).toBe(C)
      recordPlugins(ctx, 'r_inexistant')
    } finally {
      ctx.close()
    }
  })

  it('chemin relatif au fichier de configuration ; erreur de règle annoncée puis consignée', () => {
    const { ctx, events } = context("version: 1\nplugins: ['./ext.mjs']\n")
    try {
      expect(pluginSession(ctx).loaded.map((p) => p.name)).toEqual(['ext'])
      // Hors comportement de la cible (infra) : la règle n'est pas appelée.
      const infra: Classification = { status: 'INFRA_ERROR', testStatus: null }
      expect(applyPluginRules(ctx, M, infra, CALL)).toBe(infra)
      expect(events).toEqual([])
      expect(applyPluginRules(ctx, M, C, CALL)).toBe(C)
      expect(events).toEqual([{ type: 'warning', message: 'PLUGIN_FAILURE:THROWN:ext/r' }])
      ctx.writer.upsertProject({ id: ctx.projectId, name: 'p', root: ctx.root, framework: 'jest' })
      ctx.writer.createRun({
        id: 'r_1',
        projectId: ctx.projectId,
        state: 'COMPLETED',
        mode: 'normal',
        seed: 1,
        gitCommit: null,
        gitBranch: null,
        variaVersion: '0',
        configHash: 'c',
        envHash: 'e',
        planPath: null,
        partial: false,
        info: {
          plugins: {
            loaded: [],
            failures: [
              {
                plugin: 'ext',
                extension: 'ext/r',
                phase: 'fuzz',
                code: 'THROWN',
                origin: 'PLUGIN_FAILURE',
                message: 'ancien',
              },
            ],
          },
        },
      })
      recordPlugins(ctx, 'r_1')
      const info = ctx.reader.getRun('r_1')?.info['plugins'] as {
        loaded: { extensions: { disabled: boolean }[] }[]
        failures: unknown[]
      }
      // Même erreur (plugin, extension, phase, code) : consignée une seule fois.
      expect(info.failures).toHaveLength(1)
      expect(info.loaded[0]?.extensions[0]?.disabled).toBe(true)
    } finally {
      ctx.close()
    }
  })
})
