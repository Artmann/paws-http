export interface TestResult {
  name: string
  passed: boolean
  message?: string
  durationMs: number
}

export interface ClientLog {
  level: 'log' | 'warn' | 'error'
  message: string
}

export interface ScriptContext {
  globals: Record<string, unknown>
  request: Record<string, unknown>
  tests: TestResult[]
  logs: ClientLog[]
}

export interface ResponseView {
  status: number
  body: unknown
  headers: Record<string, string>
  contentType: string
}

export class ScriptError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message)
  }
}

const NAMED_IMPORT_RE =
  /^[ \t]*import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?[ \t]*\r?\n?/gm
const ANY_IMPORT_RE = /^[ \t]*import\s+/m

export interface ImportBinding {
  /** Name on the module's exports object. */
  exportName: string
  /** Name bound inside the script (after `as` aliasing). */
  localName: string
}

export interface ScriptImport {
  source: string
  bindings: ImportBinding[]
}

export interface ExtractedImports {
  imports: ScriptImport[]
  stripped: string
}

export function extractScriptImports(source: string): ExtractedImports {
  const imports: ScriptImport[] = []
  NAMED_IMPORT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = NAMED_IMPORT_RE.exec(source)) !== null) {
    const list = match[1]!
    const importSource = match[2]!
    const bindings: ImportBinding[] = []
    for (const part of list.split(',')) {
      const trimmed = part.trim()
      if (trimmed.length === 0) {
        continue
      }
      const aliasMatch = /^(\w+)(?:\s+as\s+(\w+))?$/.exec(trimmed)
      if (!aliasMatch) {
        throw new ScriptError(
          `Unsupported import specifier "${trimmed}" from "${importSource}"`
        )
      }
      const exportName = aliasMatch[1]!
      const localName = aliasMatch[2] ?? exportName
      bindings.push({ exportName, localName })
    }
    imports.push({ source: importSource, bindings })
  }

  const stripped = source.replace(NAMED_IMPORT_RE, '')

  if (ANY_IMPORT_RE.test(stripped)) {
    throw new ScriptError(
      'Only `import { ... } from "<source>"` is supported. Default and namespace imports are not.'
    )
  }

  return { imports, stripped }
}

export type ModuleMap = Record<
  string,
  Record<string, unknown> | null | undefined
>

export function runPreScript(
  source: string,
  ctx: ScriptContext,
  modules?: ModuleMap
): void {
  const { imports, stripped } = extractScriptImports(source)
  const { names, values } = resolveImports(imports, modules)
  const client = makeClient(ctx)
  const request = makeRequestApi(ctx)
  try {
    const fn = new Function('client', 'request', ...names, withStrict(stripped))
    fn(client, request, ...values)
  } catch (err) {
    throw new ScriptError(
      `Pre-request script failed: ${stringifyError(err)}`,
      err
    )
  }
}

export function runPostScript(
  source: string,
  ctx: ScriptContext,
  response: ResponseView,
  modules?: ModuleMap
): void {
  const { imports, stripped } = extractScriptImports(source)
  const { names, values } = resolveImports(imports, modules)
  const client = makeClient(ctx)
  try {
    const fn = new Function(
      'client',
      'response',
      ...names,
      withStrict(stripped)
    )
    fn(client, response, ...values)
  } catch (err) {
    throw new ScriptError(
      `Response handler failed: ${stringifyError(err)}`,
      err
    )
  }
}

interface ResolvedImports {
  names: string[]
  values: unknown[]
}

function resolveImports(
  imports: ScriptImport[],
  modules: ModuleMap | undefined
): ResolvedImports {
  const names: string[] = []
  const values: unknown[] = []
  const seen = new Set<string>()

  for (const imp of imports) {
    const exports = modules?.[imp.source]
    if (!exports) {
      throw new ScriptError(
        `Cannot resolve "${imp.source}" — file not found next to the .http file.`
      )
    }
    for (const binding of imp.bindings) {
      if (seen.has(binding.localName)) {
        continue
      }
      if (!(binding.exportName in exports)) {
        throw new ScriptError(
          `"${imp.source}" has no export "${binding.exportName}"`
        )
      }
      seen.add(binding.localName)
      names.push(binding.localName)
      values.push(exports[binding.exportName])
    }
  }

  return { names, values }
}

function withStrict(source: string): string {
  return `"use strict";\n${source}`
}

function makeClient(ctx: ScriptContext) {
  return {
    global: {
      set(key: string, value: unknown) {
        ctx.globals[key] = value
      },
      get(key: string) {
        return ctx.globals[key]
      },
      clear(key: string) {
        delete ctx.globals[key]
      },
      clearAll() {
        for (const k of Object.keys(ctx.globals)) {
          delete ctx.globals[k]
        }
      },
      isEmpty() {
        return Object.keys(ctx.globals).length === 0
      }
    },
    test(name: string, fn: () => void) {
      const start = performance.now()
      try {
        fn()
        ctx.tests.push({
          name,
          passed: true,
          durationMs: Math.round(performance.now() - start)
        })
      } catch (err) {
        ctx.tests.push({
          name,
          passed: false,
          message: stringifyError(err),
          durationMs: Math.round(performance.now() - start)
        })
      }
    },
    assert(cond: unknown, message?: string) {
      if (!cond) {
        throw new Error(message ?? 'Assertion failed')
      }
    },
    log(msg: unknown) {
      ctx.logs.push({ level: 'log', message: String(msg) })
    }
  }
}

function makeRequestApi(ctx: ScriptContext) {
  return {
    variables: {
      set(key: string, value: unknown) {
        ctx.request[key] = value
      },
      get(key: string) {
        return ctx.request[key]
      }
    }
  }
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}
