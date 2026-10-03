// Processus enfant de custom-process.test.ts (scénario 14) : `runFuzz` du moteur avec l'adaptateur
// custom, tué brutalement (SIGKILL) par le test pendant l'exécution. Arguments : racine, données, config.
// Chemin relatif : tsx ne connaît que les alias de tsconfig.json.
import { CustomAdapter } from '../../packages/adapters/custom/src/index.js'
import { EngineContext, runFuzz } from '@varia/engine'

const [root, dataDir, configFile, runId] = process.argv.slice(2) as [string, string, string, string]
const ctx = new EngineContext({
  root,
  adapter: CustomAdapter.fromConfig(root, configFile),
  dataDir,
  configFile,
})
void runFuzz(ctx, runId).finally(() => ctx.close())
