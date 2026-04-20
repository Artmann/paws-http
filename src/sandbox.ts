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

export class UtilitiesNotSupportedError extends ScriptError {
  constructor(public readonly line: number) {
    super(
      `This .http file imports from "utilities" (line ${line}). pawsh v1 does not support utilities.js — skip this step or remove the import.`
    )
  }
}

const UTILITIES_RE = /^\s*import\s*\{[^}]*\}\s*from\s*['"]utilities['"]/m

export function runPreScript(source: string, ctx: ScriptContext): void {
  guardUtilities(source)
  const client = makeClient(ctx)
  const request = makeRequestApi(ctx)
  try {
    const fn = new Function('client', 'request', withStrict(source))
    fn(client, request)
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
  response: ResponseView
): void {
  guardUtilities(source)
  const client = makeClient(ctx)
  try {
    const fn = new Function('client', 'response', withStrict(source))
    fn(client, response)
  } catch (err) {
    throw new ScriptError(
      `Response handler failed: ${stringifyError(err)}`,
      err
    )
  }
}

function withStrict(source: string): string {
  return `"use strict";\n${source}`
}

function guardUtilities(source: string): void {
  const match = UTILITIES_RE.exec(source)
  if (match) {
    const before = source.slice(0, match.index)
    const line = before.split('\n').length
    throw new UtilitiesNotSupportedError(line)
  }
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
        for (const k of Object.keys(ctx.globals)) delete ctx.globals[k]
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
      if (!cond) throw new Error(message ?? 'Assertion failed')
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
  if (err instanceof Error) return err.message
  return String(err)
}
