import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import type { ZodType } from 'zod'
import type { LlmProvider } from '../llm/types.ts'
import { callModel } from './context.ts'
import type { AgentContext, EventResult, LlmOptions, StepOptions, ToolOptions } from './types.ts'

/**
 * Run an agent without Postgres (the CLI). The journal is a JSON file next to the output,
 * so re-running the same film id after a crash or Ctrl-C skips every finished step,
 * including rendered scenes. Same semantics as the durable runtime, single process.
 */
export class LocalContext implements AgentContext {
  readonly runId: string
  readonly attempt = 1
  readonly signal: AbortSignal
  readonly replayed: string[] = []
  #journal: Record<string, unknown> = {}
  readonly #file: string | null
  readonly #llm: LlmProvider | null
  readonly #onLog: (m: string) => void
  readonly #onProgress: (d: Record<string, unknown>) => void

  constructor(opts: {
    runId: string
    journalFile?: string
    llm?: LlmProvider | null
    signal?: AbortSignal
    onLog?: (m: string) => void
    onProgress?: (d: Record<string, unknown>) => void
  }) {
    this.runId = opts.runId
    this.#file = opts.journalFile ?? null
    this.#llm = opts.llm ?? null
    this.signal = opts.signal ?? new AbortController().signal
    this.#onLog = opts.onLog ?? (() => {})
    this.#onProgress = opts.onProgress ?? (() => {})
  }

  async load(): Promise<number> {
    if (!this.#file) return 0
    try {
      this.#journal = JSON.parse(await readFile(this.#file, 'utf8'))
    } catch {
      this.#journal = {}
    }
    return Object.keys(this.#journal).length
  }

  async #save(key: string, value: unknown) {
    this.#journal[key] = value === undefined ? null : JSON.parse(JSON.stringify(value))
    if (this.#file) await writeFile(this.#file, JSON.stringify(this.#journal, null, 1))
    return this.#journal[key]
  }

  log(m: string) {
    this.#onLog(m)
  }

  progress(d: Record<string, unknown>) {
    this.#onProgress(d)
  }

  async step<T>(key: string, fn: () => Promise<T>, opts: StepOptions = {}): Promise<T> {
    if (key in this.#journal) {
      this.replayed.push(key)
      return this.#journal[key] as T
    }
    const retries = opts.retries ?? 2
    for (let attempt = 1; ; attempt++) {
      try {
        return (await this.#save(key, await fn())) as T
      } catch (err) {
        if (attempt > retries) throw err
        this.log(`step "${key}" failed (try ${attempt}): ${String(err)}`)
        await sleep(300 * attempt)
      }
    }
  }

  llm(key: string, opts: LlmOptions<undefined> & { schema?: undefined }): Promise<string>
  llm<T>(key: string, opts: LlmOptions<T> & { schema: ZodType<T> }): Promise<T>
  async llm<T>(key: string, opts: LlmOptions<T>): Promise<T | string> {
    if (!this.#llm) throw new Error('no LLM configured')
    const llm = this.#llm
    return this.step(key, async () => (await callModel(llm, opts, this.signal)).value)
  }

  async tool<T>(key: string, fn: (k: string) => Promise<T>, _opts?: ToolOptions): Promise<T> {
    return this.step(key, () => fn(`co_${this.runId}_${key}`))
  }

  async sleep(_key: string, ms: number): Promise<void> {
    await sleep(ms)
  }

  async waitForEvent<T>(): Promise<EventResult<T> | null> {
    return null
  }
}
