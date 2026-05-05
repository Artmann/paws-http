import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ScriptError } from './sandbox.js'
import {
  clearUtilitiesCache,
  compileModule,
  loadModule,
  loadUtilities,
  resolveModuleSpecifier
} from './utilities.js'

const tmpDirs: string[] = []

afterEach(async () => {
  clearUtilitiesCache()
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!
    await rm(dir, { recursive: true, force: true })
  }
})

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'paws-http-utils-'))
  tmpDirs.push(dir)
  return dir
}

test('compileModule extracts named exports across declarations', () => {
  const exports = compileModule(`
export function foo() { return 1; }
export const bar = 2;
export class Baz { hello() { return 'hi'; } }
function helper() { return 'h'; }
export const usesHelper = helper();
`)
  expect((exports.foo as () => number)()).toBe(1)
  expect(exports.bar).toBe(2)
  expect(typeof exports.Baz).toBe('function')
  expect(exports.usesHelper).toBe('h')
})

test('compileModule keeps internal references between exported helpers', () => {
  const exports = compileModule(`
export function inner() { return 42; }
export function outer() { return inner() + 1; }
`)
  expect((exports.outer as () => number)()).toBe(43)
})

test('resolveModuleSpecifier handles bare "utilities" and relative paths', () => {
  const httpFile = '/tmp/flows/api.http'
  expect(resolveModuleSpecifier(httpFile, 'utilities')).toBe(
    '/tmp/flows/utilities.js'
  )
  expect(resolveModuleSpecifier(httpFile, './helpers')).toBe(
    '/tmp/flows/helpers.js'
  )
  expect(resolveModuleSpecifier(httpFile, './helpers.js')).toBe(
    '/tmp/flows/helpers.js'
  )
  expect(resolveModuleSpecifier(httpFile, '../shared/helpers.js')).toBe(
    '/tmp/shared/helpers.js'
  )
  expect(resolveModuleSpecifier(httpFile, 'lodash')).toBeNull()
})

test('loadUtilities returns null when sibling utilities.js is missing', async () => {
  const dir = await makeTmpDir()
  const httpFile = join(dir, 'flow.http')
  await writeFile(httpFile, '### 1.1 noop\nGET http://example.com\n', 'utf-8')

  const result = await loadUtilities(httpFile)
  expect(result).toBeNull()
})

test('loadUtilities loads sibling utilities.js and returns named exports', async () => {
  const dir = await makeTmpDir()
  const httpFile = join(dir, 'flow.http')
  await writeFile(httpFile, '### 1.1 noop\nGET http://example.com\n', 'utf-8')
  await writeFile(
    join(dir, 'utilities.js'),
    `
export function get_valid_address(country) {
  return { country, city: 'Town' };
}
export function wait(seconds) { return seconds; }
`,
    'utf-8'
  )

  const exports = await loadUtilities(httpFile)
  expect(exports).not.toBeNull()
  const fn = exports!.get_valid_address as (c: string) => unknown
  expect(fn('GB')).toEqual({ country: 'GB', city: 'Town' })
  expect((exports!.wait as (n: number) => number)(3)).toBe(3)
})

test('loadModule resolves a relative .js sibling', async () => {
  const dir = await makeTmpDir()
  const httpFile = join(dir, 'flow.http')
  await writeFile(httpFile, '### 1.1 noop\nGET http://example.com\n', 'utf-8')
  await writeFile(
    join(dir, 'helpers.js'),
    `export const upper = (s) => s.toUpperCase();`,
    'utf-8'
  )

  const exports = await loadModule(httpFile, './helpers.js')
  expect(exports).not.toBeNull()
  expect((exports!.upper as (s: string) => string)('abc')).toBe('ABC')
})

test('loadModule wraps syntax errors in ScriptError', async () => {
  const dir = await makeTmpDir()
  const httpFile = join(dir, 'flow.http')
  await writeFile(httpFile, '### 1.1 noop\nGET http://example.com\n', 'utf-8')
  await writeFile(
    join(dir, 'utilities.js'),
    `export function broken( {`,
    'utf-8'
  )

  await expect(loadUtilities(httpFile)).rejects.toBeInstanceOf(ScriptError)
})
