import os from 'node:os'
import { Worker } from 'node:worker_threads'
import type { DiffOptions, DiffResponse, DiffResult } from './types.ts'

interface Task {
  resolve: (result: DiffResult) => void
  reject: (error: Error) => void
}

interface PooledWorker {
  worker: Worker
  tasks: Map<number, Task>
}

// Leaves a core for the test runner and the browser it drives. The cap is there because sharp
// decodes on its own libuv thread pool, so extra workers compete for the same cores.
// IMAGE_SNAPSHOT_WORKERS overrides it.
const DEFAULT_MAX_WORKERS = 4

export const resolvePoolSize = (environment: string | undefined = process.env.IMAGE_SNAPSHOT_WORKERS): number => {
  const fromEnvironment = Number.parseInt(environment ?? '', 10)
  if (fromEnvironment > 0) {
    return fromEnvironment
  }
  return Math.max(1, Math.min(DEFAULT_MAX_WORKERS, os.availableParallelism() - 1))
}

const toError = ({ name, message, stack }: { name: string; message: string; stack?: string }) =>
  Object.assign(new Error(message), { name, stack })

export const createWorkerPool = (workerPath: string, size = resolvePoolSize()) => {
  const workers: PooledWorker[] = []
  let nextId = 0

  const spawn = (): PooledWorker => {
    const pooled: PooledWorker = { worker: new Worker(workerPath), tasks: new Map() }
    // An idle worker must not keep the test process alive
    pooled.worker.unref()
    pooled.worker.on('message', (response: DiffResponse) => {
      const task = pooled.tasks.get(response.id)
      pooled.tasks.delete(response.id)
      if (pooled.tasks.size === 0) {
        pooled.worker.unref()
      }
      if ('error' in response) {
        task?.reject(toError(response.error))
      } else {
        task?.resolve(response.result)
      }
    })
    // A crashed worker fails its own checks and is replaced on the next call
    pooled.worker.on('error', (error: unknown) => {
      workers.splice(workers.indexOf(pooled), 1)
      for (const task of pooled.tasks.values()) {
        task.reject(error instanceof Error ? error : new Error(String(error)))
      }
      pooled.tasks.clear()
    })
    workers.push(pooled)
    return pooled
  }

  // Workers start on demand, so a suite with few failures pays for one at most
  const pick = (): PooledWorker => {
    const idle = workers.find((pooled) => pooled.tasks.size === 0)
    if (idle) {
      return idle
    }
    if (workers.length < size) {
      return spawn()
    }
    return workers.reduce((least, pooled) => (pooled.tasks.size < least.tasks.size ? pooled : least))
  }

  const run = (options: DiffOptions) =>
    new Promise<DiffResult>((resolve, reject) => {
      const pooled = pick()
      const id = nextId++
      pooled.tasks.set(id, { resolve, reject })
      pooled.worker.ref()
      pooled.worker.postMessage({ id, options })
    })

  return {
    run,
    get size() {
      return workers.length
    },
  }
}
