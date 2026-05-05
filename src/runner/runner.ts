import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { ResolvedEnv } from '../env'
import type { Flow, Step } from '../parser/types'
import {
  extractScriptImports,
  runPostScript,
  runPreScript,
  ScriptError,
  type ModuleMap,
  type ScriptContext
} from '../sandbox'
import { loadModule } from '../utilities'
import { createScope, substitute, type VarScope } from '../vars'
import type {
  FlowReport,
  PreparedRequest,
  ResponseSnapshot,
  RunnerEvent,
  StepReport
} from './types'

export interface RunOptions {
  env: ResolvedEnv
  /** If provided, only run steps whose `num` appears in this set. */
  onlySteps?: Set<string>
  failFast?: boolean
  /** Per-request timeout in ms. Default 30s. */
  timeoutMs?: number
  onEvent?: (event: RunnerEvent) => void
  /** Injected for tests. */
  fetcher?: typeof fetch
}

export async function runFlow(
  flow: Flow,
  options: RunOptions
): Promise<FlowReport> {
  const fetcher = options.fetcher ?? fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  const globals: Record<string, unknown> = {}
  const reports: StepReport[] = []
  const onEvent = options.onEvent ?? (() => {})
  const flowStart = performance.now()
  let anyFail = false
  let skipping = false

  for (let i = 0; i < flow.steps.length; i += 1) {
    const step = flow.steps[i]!
    if (options.onlySteps && !options.onlySteps.has(step.num)) {
      reports.push({ step, status: 'skipped', durationMs: 0, tests: [] })
      continue
    }
    if (skipping) {
      reports.push({ step, status: 'skipped', durationMs: 0, tests: [] })
      continue
    }

    onEvent({ kind: 'step:start', stepIndex: i, step })

    const report = await runStep(step, flow.filePath, {
      env: options.env,
      globals,
      fetcher,
      timeoutMs
    })
    reports.push(report)
    onEvent({ kind: 'step:done', stepIndex: i, report })

    if (report.status === 'fail' || report.status === 'error') {
      anyFail = true
      if (options.failFast) skipping = true
    }
  }

  const flowReport: FlowReport = {
    flow,
    status: anyFail ? 'fail' : 'pass',
    durationMs: Math.round(performance.now() - flowStart),
    steps: reports,
    env: options.env.name
  }
  onEvent({ kind: 'flow:done', report: flowReport })
  return flowReport
}

interface StepRunDeps {
  env: ResolvedEnv
  globals: Record<string, unknown>
  fetcher: typeof fetch
  timeoutMs: number
}

async function runStep(
  step: Step,
  filePath: string,
  deps: StepRunDeps
): Promise<StepReport> {
  const ctx: ScriptContext = {
    globals: deps.globals,
    request: {},
    tests: [],
    logs: []
  }
  const scope: VarScope = createScope(deps.env, deps.globals, ctx.request)
  const start = performance.now()

  // 1. Pre-request script.
  if (step.preScript) {
    let modules: ModuleMap
    try {
      modules = await loadModulesFor(step.preScript, filePath)
    } catch (err) {
      return errorReport(step, ctx, start, 'pre-script', err)
    }
    try {
      runPreScript(step.preScript, ctx, modules)
    } catch (err) {
      return errorReport(step, ctx, start, 'pre-script', err)
    }
  }

  // 2. Substitute URL, headers, body.
  let prepared: PreparedRequest
  try {
    prepared = await prepareRequest(step, scope, filePath)
  } catch (err) {
    return errorReport(step, ctx, start, 'substitute', err)
  }

  // 3. Fetch.
  let snapshot: ResponseSnapshot
  try {
    snapshot = await performRequest(prepared, deps.fetcher, deps.timeoutMs)
  } catch (err) {
    return {
      step,
      status: 'error',
      durationMs: Math.round(performance.now() - start),
      prepared,
      tests: ctx.tests,
      error: { phase: 'fetch', message: stringifyError(err) }
    }
  }

  // 4. Post-script + tests.
  if (step.postScript) {
    let modules: ModuleMap
    try {
      modules = await loadModulesFor(step.postScript, filePath)
    } catch (err) {
      return {
        step,
        status: 'error',
        durationMs: Math.round(performance.now() - start),
        prepared,
        response: snapshot,
        tests: ctx.tests,
        error: { phase: 'post-script', message: stringifyError(err) }
      }
    }
    try {
      runPostScript(
        step.postScript,
        ctx,
        {
          status: snapshot.status,
          body: snapshot.parsedBody ?? snapshot.rawBody,
          headers: snapshot.headers,
          contentType: snapshot.contentType
        },
        modules
      )
    } catch (err) {
      return {
        step,
        status: 'error',
        durationMs: Math.round(performance.now() - start),
        prepared,
        response: snapshot,
        tests: ctx.tests,
        error: { phase: 'post-script', message: stringifyError(err) }
      }
    }
  }

  const anyTestFailed = ctx.tests.some((t) => !t.passed)
  return {
    step,
    status: anyTestFailed ? 'fail' : 'pass',
    durationMs: Math.round(performance.now() - start),
    prepared,
    response: snapshot,
    tests: ctx.tests
  }
}

async function loadModulesFor(
  scriptSource: string,
  httpFilePath: string
): Promise<ModuleMap> {
  const { imports } = extractScriptImports(scriptSource)
  const modules: ModuleMap = {}
  for (const imp of imports) {
    if (imp.source in modules) {
      continue
    }
    const exports = await loadModule(httpFilePath, imp.source)
    if (!exports) {
      throw new ScriptError(
        `Cannot resolve "${imp.source}" — file not found next to ${httpFilePath}.`
      )
    }
    modules[imp.source] = exports
  }
  return modules
}

function errorReport(
  step: Step,
  ctx: ScriptContext,
  start: number,
  phase: StepReport['error'] extends infer T
    ? T extends { phase: infer P }
      ? P
      : never
    : never,
  err: unknown
): StepReport {
  return {
    step,
    status: 'error',
    durationMs: Math.round(performance.now() - start),
    tests: ctx.tests,
    error: { phase, message: stringifyError(err) }
  }
}

async function prepareRequest(
  step: Step,
  scope: VarScope,
  filePath: string
): Promise<PreparedRequest> {
  const url = substitute(step.url, scope)
  const headers: Record<string, string> = {}
  for (const h of step.headers) {
    headers[h.name] = substitute(h.value, scope)
  }

  let body: string | undefined
  if (step.body.kind === 'text') {
    body = substitute(step.body.text, scope)
  } else if (step.body.kind === 'file') {
    const abs = resolve(dirname(filePath), step.body.path)
    body = await readFile(abs, 'utf-8')
  }

  return { method: step.method, url, headers, body }
}

async function performRequest(
  prepared: PreparedRequest,
  fetcher: typeof fetch,
  timeoutMs: number
): Promise<ResponseSnapshot> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetcher(prepared.url, {
      method: prepared.method,
      headers: prepared.headers,
      body: ['GET', 'HEAD'].includes(prepared.method)
        ? undefined
        : prepared.body,
      signal: controller.signal
    })
    const rawBody = await res.text()
    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      headers[key] = value
    })
    const contentType = headers['content-type'] ?? ''
    let parsedBody: unknown
    if (/\bjson\b/i.test(contentType) && rawBody.length > 0) {
      try {
        parsedBody = JSON.parse(rawBody)
      } catch {
        // leave undefined; handlers can still read rawBody.
      }
    }
    return {
      status: res.status,
      statusText: res.statusText,
      headers,
      contentType,
      rawBody,
      parsedBody
    }
  } finally {
    clearTimeout(t)
  }
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}
