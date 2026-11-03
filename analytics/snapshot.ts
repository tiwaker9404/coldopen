#!/usr/bin/env node
/**
 * One day's snapshot of every open role coldopen reads (450+ companies' Greenhouse, Lever and
 * Ashby boards), as gzipped CSV: the raw layer of the hiring signals pipeline. The dbt project in
 * analytics/ models the snapshots into the Hiring Index.
 *
 *   node analytics/snapshot.ts <out dir>     writes <out dir>/YYYY-MM-DD.csv.gz
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { type Board, boardKey, fetchBoard, type Job } from '../src/jobs/boards.ts'
import { DEFAULT_BOARDS, visaOf, ycOf } from '../src/jobs/companies.ts'
import { inUS, levelOf } from '../src/jobs/where.ts'

const COLUMNS = [
  'snapshot_date',
  'board',
  'company',
  'yc_batch',
  'visa_sponsor',
  'job_id',
  'title',
  'location',
  'in_us',
  'remote',
  'workplace',
  'job_type',
  'level',
  'team',
  'posted_at',
  'pay_min',
  'pay_max',
  'pay_currency',
] as const

const cell = (v: unknown) => {
  if (v === undefined || v === null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function rowsOf(b: Board, jobs: Job[], day: string): string[] {
  const yc = ycOf({ board: b })
  const visa = !!visaOf(boardKey(b))
  return jobs.map((j) =>
    [
      day,
      j.board,
      b.name,
      yc?.batch ?? '',
      visa,
      j.id,
      j.title,
      j.location,
      inUS(j),
      j.remote,
      j.workplace ?? '',
      j.type ?? '',
      levelOf(j.title),
      j.team ?? '',
      j.posted ?? '',
      j.pay?.min ?? '',
      j.pay?.max ?? '',
      j.pay?.currency ?? '',
    ]
      .map(cell)
      .join(','),
  )
}

async function main() {
  const out = process.argv[2] ?? 'snapshots'
  const day = new Date().toISOString().slice(0, 10)
  const lines = [COLUMNS.join(',')]
  let ok = 0
  const queue = [...DEFAULT_BOARDS]
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      for (let b = queue.shift(); b; b = queue.shift()) {
        try {
          lines.push(...rowsOf(b, await fetchBoard(b, { timeoutMs: 30_000 }), day))
          ok++
        } catch {}
      }
    }),
  )
  await mkdir(out, { recursive: true })
  const file = join(out, `${day}.csv.gz`)
  await writeFile(file, gzipSync(`${lines.join('\n')}\n`))
  console.log(`${file}: ${lines.length - 1} roles from ${ok} of ${DEFAULT_BOARDS.length} boards`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
