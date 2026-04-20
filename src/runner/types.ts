import type { Flow, Step } from '../parser/types'
import type { TestResult } from '../sandbox'

export type StepStatus =
  | 'pending'
  | 'running'
  | 'pass'
  | 'fail'
  | 'skipped'
  | 'error'

export interface StepReport {
  step: Step
  status: StepStatus
  durationMs: number
  /** The fully-substituted request, if we got that far. */
  prepared?: PreparedRequest
  response?: ResponseSnapshot
  tests: TestResult[]
  error?: { phase: Phase; message: string }
}

export type Phase =
  | 'pre-script'
  | 'substitute'
  | 'fetch'
  | 'post-script'
  | 'parse-body'

export interface PreparedRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export interface ResponseSnapshot {
  status: number
  statusText: string
  headers: Record<string, string>
  contentType: string
  /** Raw body text as returned by the server. */
  rawBody: string
  /** Parsed body if content-type suggested JSON, else undefined. */
  parsedBody?: unknown
}

export interface FlowReport {
  flow: Flow
  status: StepStatus
  durationMs: number
  steps: StepReport[]
  env: string
}

export type RunnerEvent =
  | { kind: 'step:start'; stepIndex: number; step: Step }
  | {
      kind: 'step:done'
      stepIndex: number
      report: StepReport
    }
  | { kind: 'flow:done'; report: FlowReport }
