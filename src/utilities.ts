import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { ScriptError } from './sandbox.js'

const cache = new Map<string, Promise<Record<string, unknown> | null>>()

/**
 * Resolve a JetBrains-HTTP-style import specifier against the directory of
 * the .http file that referenced it.
 *
 * Supported forms:
 *   - bare `"utilities"`           -> `<dir>/utilities.js`
 *   - relative `"./foo"` / `"../bar.js"` -> resolved against `<dir>`
 *
 * Returns `null` for unsupported specifiers (e.g. third-party module names).
 */
export function resolveModuleSpecifier(
  httpFilePath: string,
  specifier: string
): string | null {
  const baseDir = dirname(resolve(httpFilePath))

  if (specifier === 'utilities') {
    return resolve(baseDir, 'utilities.js')
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const withExt = /\.[cm]?js$/.test(specifier) ? specifier : `${specifier}.js`
    return resolve(baseDir, withExt)
  }
  if (isAbsolute(specifier)) {
    const withExt = /\.[cm]?js$/.test(specifier) ? specifier : `${specifier}.js`
    return resolve(withExt)
  }
  return null
}

export async function loadModule(
  httpFilePath: string,
  specifier: string
): Promise<Record<string, unknown> | null> {
  const absolutePath = resolveModuleSpecifier(httpFilePath, specifier)
  if (!absolutePath) {
    return null
  }

  const cached = cache.get(absolutePath)
  if (cached) {
    return cached
  }

  const promise = loadAndCompile(absolutePath)
  cache.set(absolutePath, promise)
  return promise
}

/** Back-compat shim — only resolves the bare `"utilities"` specifier. */
export async function loadUtilities(
  httpFilePath: string
): Promise<Record<string, unknown> | null> {
  return loadModule(httpFilePath, 'utilities')
}

async function loadAndCompile(
  absolutePath: string
): Promise<Record<string, unknown> | null> {
  let source: string
  try {
    source = await readFile(absolutePath, 'utf-8')
  } catch (err) {
    if (isNotFound(err)) {
      return null
    }
    throw new ScriptError(
      `Failed to read module at ${absolutePath}: ${stringifyError(err)}`,
      err
    )
  }

  try {
    return compileModule(source)
  } catch (err) {
    throw new ScriptError(
      `Failed to load module at ${absolutePath}: ${stringifyError(err)}`,
      err
    )
  }
}

const EXPORT_DECL_RE =
  /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+(\w+)/gm

export function compileModule(source: string): Record<string, unknown> {
  const names: string[] = []
  EXPORT_DECL_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = EXPORT_DECL_RE.exec(source)) !== null) {
    names.push(match[1]!)
  }

  const stripped = source.replace(
    /^(\s*)export\s+(?:default\s+)?/gm,
    (_full, leading: string) => leading
  )

  const returnObject = names.length === 0 ? '{}' : `{ ${names.join(', ')} }`
  const body = `"use strict";\n${stripped}\n;return ${returnObject};`

  const factory = new Function(body)
  return factory() as Record<string, unknown>
}

export function clearUtilitiesCache(): void {
  cache.clear()
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  )
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}
