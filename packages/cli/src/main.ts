// Point d'entrée du binaire `varia` (bin/varia).
import { processIo } from './io.js'
import { runCli } from './program.js'

const startDashboard = async (o: {
  dataDir: string
  port: number
  host: string
  env: NodeJS.ProcessEnv
}) => {
  const { startServer } = await import('@varia/api')
  return startServer(o)
}

process.exitCode = await runCli(process.argv.slice(2), processIo, {
  env: process.env,
  cwd: process.cwd(),
  startDashboard,
})
