import { fileURLToPath } from 'node:url'
import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from 'node:worker_threads'

/**
 * Fichier de l'hôte (exécuté tel quel dans le thread, jamais compilé). Calculé à l'usage : importer
 * le paquet ne lit pas `import.meta.url` (environnements de test sans URL `file:`, ex. jsdom).
 */
export function hostPath(): string {
  return fileURLToPath(new URL('../runtime/host.cjs', import.meta.url))
}

/** Réponse de l'hôte (voir runtime/host.cjs). */
export type HostResponse =
  | { ok: true; value: unknown; mathRandom?: boolean }
  | { ok: false; code: string; message: string; mathRandom?: boolean }

/** Amorce du thread : charge l'hôte par le `require` de Node et le démarre. */
const BOOT =
  "const { workerData } = require('node:worker_threads'); require(workerData.host).start(workerData)"

/**
 * Thread d'un plugin, appelé de façon SYNCHRONE avec un délai borné : la requête est postée, le
 * thread principal attend le signal (`Atomics.wait`) puis lit la réponse. Au-delà du délai, le thread
 * est arrêté (`terminate`, qui interrompt aussi une boucle synchrone) et le plugin est hors service.
 */
export class PluginThread {
  private readonly worker: Worker
  private readonly port: MessagePort
  private readonly flag: Int32Array
  private dead = false

  constructor(private readonly timeoutMs: number) {
    const { port1, port2 } = new MessageChannel()
    const signal = new SharedArrayBuffer(4)
    this.flag = new Int32Array(signal)
    this.port = port1
    this.worker = new Worker(BOOT, {
      eval: true,
      workerData: { host: hostPath(), port: port2, signal },
      transferList: [port2],
      // Sortie standard d'une extension ignorée : elle ne pollue jamais la sortie de Varia (`--json`).
      stdout: true,
    })
    this.worker.stdout.resume()
    // Erreur non rattrapée dans le thread (minuterie d'une extension qui lève…) : le thread meurt, les
    // appels suivants échouent (délai) ; jamais une exception dans le processus Varia.
    this.worker.on('error', () => {
      this.dead = true
    })
    // Le thread ne retient jamais la fin du processus Varia.
    this.worker.unref()
  }

  request(msg: Record<string, unknown>): HostResponse {
    if (this.dead) return { ok: false, code: 'TIMEOUT', message: 'thread arrêté' }
    Atomics.store(this.flag, 0, 0)
    this.port.postMessage(msg)
    Atomics.wait(this.flag, 0, 0, this.timeoutMs)
    const got = receiveMessageOnPort(this.port)
    if (got === undefined) {
      this.close()
      return {
        ok: false,
        code: 'TIMEOUT',
        message: `aucune réponse en ${String(this.timeoutMs)} ms (boucle ou thread arrêté)`,
      }
    }
    return got.message as HostResponse
  }

  close(): void {
    this.dead = true
    this.port.close()
    void this.worker.terminate()
  }
}
