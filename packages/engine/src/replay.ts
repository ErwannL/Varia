import type { Classification, PlannedMutation } from '@varia/core'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { prepareContext } from './baseline.js'
import type { EngineContext } from './context.js'
import { VariaError } from './errors.js'
import { executeMutation, type ExecutedCall } from './fuzz.js'
import { readPlan } from './planning.js'

export interface ReplayResult {
  runId: string
  mutation: PlannedMutation
  classification: Classification
  previous: { status: string; subtype: string | null } | null
  /** Environnement différent de celui du run d'origine (CDC §42) : pas de résultat strictement identique garanti. */
  environmentChanged: boolean
  sameAsRecorded: boolean | null
  /** Appels observés dans le test pendant le rejeu (un seul doit être `mutated`). */
  calls: ExecutedCall[]
}

/** `varia replay <mutation-id>` : rejoue la mutation exacte du plan sauvegardé (CDC §42). */
export async function replayMutation(
  ctx: EngineContext,
  mutationId: string,
): Promise<ReplayResult> {
  const runId = ctx.reader.runOfMutation(mutationId)
  const run = runId === null ? null : ctx.reader.getRun(runId)
  if (run === null || run.planPath === null)
    throw new VariaError('PROJECT_FAILURE', `mutation inconnue : ${mutationId}`)
  const mutation = readPlan(run.planPath).mutations.find((m) => m.id === mutationId)
  if (mutation === undefined)
    throw new VariaError('PROJECT_FAILURE', `mutation absente du plan : ${mutationId}`)
  const detect = await ctx.adapter.detect(ctx.root)
  const environmentChanged =
    ctx.envHash(detect.version) !== run.envHash || ctx.config.hash !== run.configHash
  const tmpDir = join(ctx.dataDir, 'tmp', `${run.id}-replay-${mutationId}`)
  mkdirSync(tmpDir, { recursive: true })
  try {
    await ctx.adapter.prepare(prepareContext(ctx, run.id, tmpDir))
    const baselineMs =
      ctx.reader.tests(run.id).find((t) => t.testId === mutation.testId)?.durationMs ?? null
    const { classification, calls } = await executeMutation(
      ctx,
      mutation,
      run.planPath,
      tmpDir,
      baselineMs,
    )
    const prev = ctx.reader.result(run.id, mutationId)
    ctx.writer.event(run.id, 'MUTATION_REPLAYED', {
      mutationId,
      status: classification.status,
      environmentChanged,
    })
    return {
      runId: run.id,
      mutation,
      classification,
      previous: prev === null ? null : { status: prev.status, subtype: prev.subtype },
      environmentChanged,
      sameAsRecorded:
        prev === null
          ? null
          : prev.status === classification.status &&
            (prev.subtype ?? undefined) === classification.subtype,
      calls,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}
