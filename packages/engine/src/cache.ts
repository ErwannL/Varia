import { manifestSnapshot, type PlannedMutation } from '@varia/core'
import { sha256, stableStringify } from '@varia/probe-runtime'
import type { EngineContext } from './context.js'
import { integrityOptions } from './integrity.js'
import { VARIA_VERSION } from './version.js'

/**
 * Empreinte du CONTENU de tout le projet (hors node_modules et dossiers ignorés de l'intégrité) :
 * la moindre modification d'un fichier invalide le cache (CDC §30, choix conservateur).
 */
export function projectContentHash(ctx: EngineContext): string {
  // Le stockage de Varia (base, plans) change à chaque run : il n'est jamais du contenu du projet.
  const snap = manifestSnapshot(ctx.root, ['.git', '.varia', ...integrityOptions(ctx).ignore])
  return sha256(stableStringify([...snap.entries()].sort()))
}

/** Clé de cache d'une mutation : version, environnement, configuration, contenu, définition exacte. */
export function cacheKey(
  ctx: EngineContext,
  envHash: string,
  contentHash: string,
  m: PlannedMutation,
): string {
  return sha256(stableStringify([VARIA_VERSION, envHash, ctx.config.hash, contentHash, m]))
}
