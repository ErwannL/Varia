// @ts-check
'use strict'
// Superviseur d'un processus de test (CDC §16.2) : chef de groupe de processus, il lance la commande,
// applique le timeout LUI-MÊME (même si l'orchestrateur meurt) et tue tout l'arbre à l'échéance.
// Usage : node supervisor.cjs <timeoutMs> <statusFile> -- <commande> [args…]

const childProcess = require('child_process')
const fs = require('fs')

/**
 * Dépendances système, injectables pour tester les deux plateformes sur n'importe quel système.
 * @typedef {object} SupervisorDeps
 * @property {NodeJS.Platform} platform
 * @property {(cmd: string, args: string[]) => import('child_process').ChildProcess} spawn
 * @property {(cmd: string, args: string[]) => unknown} spawnSync
 * @property {(file: string, data: string) => void} writeFile
 * @property {(code: number) => void} exit
 * @property {(pid: number, signal: string) => void} kill
 * @property {(s: string) => void} stderr
 * @property {number} pid pid du superviseur (chef de groupe)
 * @property {(fn: () => void, ms: number) => unknown} setTimeout
 * @property {(t: unknown) => void} clearTimeout
 */

/** @returns {SupervisorDeps} */
function systemDeps() {
  return {
    platform: process.platform,
    spawn: (cmd, args) => childProcess.spawn(cmd, args, { stdio: 'inherit', windowsHide: true }),
    spawnSync: (cmd, args) => childProcess.spawnSync(cmd, args, { stdio: 'ignore' }),
    writeFile: (file, data) => fs.writeFileSync(file, data),
    exit: (code) => process.exit(code),
    kill: (pid, signal) => process.kill(pid, signal),
    stderr: (s) => process.stderr.write(s),
    pid: process.pid,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(/** @type {NodeJS.Timeout} */ (t)),
  }
}

/**
 * Lance la commande et la surveille. Code 64 : usage incorrect.
 * @param {string[]} argv arguments après `node supervisor.cjs`
 * @param {SupervisorDeps} deps
 */
function supervise(argv, deps) {
  const [timeoutArg, statusFile, sep, command, ...args] = argv
  if (sep !== '--' || !command || !statusFile) {
    deps.stderr('usage: supervisor.cjs <timeoutMs> <statusFile> -- <command> [args...]\n')
    deps.exit(64)
    return
  }
  const child = deps.spawn(command, args)
  const writeStatus = (/** @type {Record<string, unknown>} */ status) =>
    deps.writeFile(statusFile, JSON.stringify(status))
  const killAll = () => {
    if (deps.platform === 'win32') {
      // Windows n'a pas de groupes de processus : `taskkill /T` tue l'arbre de l'enfant.
      deps.spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
      deps.exit(124)
    } else {
      // Tue tout le groupe (dont ce superviseur, chef de groupe).
      deps.kill(-deps.pid, 'SIGKILL')
    }
  }
  const timer = deps.setTimeout(() => {
    writeStatus({ timedOut: true, exitCode: null, signal: null })
    killAll()
  }, Number(timeoutArg))
  child.on('exit', (code, signal) => {
    deps.clearTimeout(timer)
    writeStatus({ timedOut: false, exitCode: code, signal })
    deps.exit(code ?? 1)
  })
}

if (require.main === module) supervise(process.argv.slice(2), systemDeps())

module.exports = { supervise, systemDeps }
