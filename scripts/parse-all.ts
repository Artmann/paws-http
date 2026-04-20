/**
 * Bulk-parse every `.http` file under a given directory.
 * Usage:  bun scripts/parse-all.ts <path>
 *
 * Useful for regression-testing the parser against a real-world corpus.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseHttpFile } from '../src/parser/parser'

const arg = process.argv[2]
if (!arg) {
  console.error('Usage: bun scripts/parse-all.ts <directory>')
  process.exit(2)
}

const ROOT = resolve(arg)

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const out: string[] = []
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p)))
    else if (e.isFile() && e.name.endsWith('.http')) out.push(p)
  }
  return out
}

const files = await walk(ROOT)
let ok = 0
let fail = 0
for (const f of files) {
  try {
    const src = await readFile(f, 'utf-8')
    const flow = parseHttpFile(f, src)
    ok += 1
    if (flow.steps.length === 0) {
      console.log(`(0 steps) ${f}`)
    }
  } catch (err) {
    fail += 1
    console.log(`FAIL ${f}: ${err instanceof Error ? err.message : err}`)
  }
}
console.log(`\n${ok} ok / ${fail} fail / ${files.length} total`)

if (fail > 0) process.exit(1)
