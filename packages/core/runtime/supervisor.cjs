// @ts-check
'use strict'
// Superviseur d'un processus de test (CDC §16.2) : chef de groupe de processus, il lance la commande,
// applique le timeout LUI-MÊME (même si l'orchestrateur meurt) et tue tout l'arbre à l'échéance.
// Usage : node supervisor.cjs <timeoutMs> <statusFile> -- <commande> [args…]

const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')

const [timeoutArg, statusFile, sep, command, ...args] = process.argv.slice(2)
if (sep !== '--' || !command || !statusFile) {
  process.stderr.write('usage: supervisor.cjs <timeoutMs> <statusFile> -- <command> [args...]\n')
  process.exit(64)
}
const timeoutMs = Number(timeoutArg)
const child = spawn(command, args, { stdio: 'inherit', windowsHide: true })

/** @param {Record<string, unknown>} status */
function writeStatus(status) {
  fs.writeFileSync(String(statusFile), JSON.stringify(status))
}

const killAll = () => {
  if (process.platform === 'win32') {
    if (child.pid !== undefined)
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    process.exit(124)
  } else {
    // Tue tout le groupe (dont ce superviseur, chef de groupe).
    process.kill(-process.pid, 'SIGKILL')
  }
}

const timer = setTimeout(() => {
  writeStatus({ timedOut: true, exitCode: null, signal: null })
  killAll()
}, timeoutMs)

child.on('exit', (code, signal) => {
  clearTimeout(timer)
  writeStatus({ timedOut: false, exitCode: code, signal })
  process.exit(code ?? 1)
})
