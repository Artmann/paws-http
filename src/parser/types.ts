export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'

export interface Header {
  name: string
  value: string
}

export type Body =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'file'; path: string }

export interface Step {
  /** Numeric label like "1.1" extracted from `### 1.1 Title`, or sequential fallback. */
  num: string
  /** Display title (everything after `### <num>?` on the separator line). */
  title: string
  /** Banner comments (lines starting with `##`/`#`) accumulated before this step. */
  section?: string
  method: HttpMethod
  url: string
  headers: Header[]
  body: Body
  /** Raw JS source between `< {%` and `%}`. Undefined if absent. */
  preScript?: string
  /** Raw JS source between `> {%` and `%}`. Undefined if absent. */
  postScript?: string
  /** 1-based line numbers in the source file. */
  sourceRange: { startLine: number; endLine: number }
}

export interface Flow {
  filePath: string
  steps: Step[]
  /** Parse diagnostics that didn't stop parsing (unsupported features, etc.). */
  warnings: ParseWarning[]
}

export interface ParseWarning {
  line: number
  message: string
}

export class ParseError extends Error {
  constructor(
    message: string,
    public line: number,
    public filePath: string
  ) {
    super(`${filePath}:${line}: ${message}`)
    this.name = 'ParseError'
  }
}
