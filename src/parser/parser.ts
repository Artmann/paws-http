import type {
  Body,
  Flow,
  Header,
  HttpMethod,
  ParseWarning,
  Step
} from './types'
import { ParseError } from './types'

const METHODS: readonly HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS'
]

const METHOD_RE = new RegExp(`^(${METHODS.join('|')})\\s+(.+?)\\s*$`)
/** Short-form GET: a bare URL on a line (http(s)://… or {{var}}/…). */
const SHORT_URL_RE = /^(https?:\/\/\S.*|\{\{[^}]+\}\}\S*.*)$/
const SEPARATOR_RE = /^###\s*(.*)$/
const PRE_OPEN_RE = /^<\s*\{%\s*$/
const POST_OPEN_RE = /^>\s*\{%\s*$/
const SCRIPT_CLOSE_RE = /^\s*%\}\s*$/
const FILE_BODY_RE = /^<\s+(\S+.*)$/
const HEADER_RE = /^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/
const STEP_NUM_RE = /^(\d+(?:\.\d+)*)\s*(.*)$/
/** Optional trailing ` HTTP/1.1` on a request line — strip before method match. */
const HTTP_VERSION_RE = /\s+HTTP\/\d(?:\.\d)?\s*$/

interface WorkingStep {
  num: string | null
  title: string
  section: string | null
  method: HttpMethod | null
  url: string
  headers: Header[]
  body: Body
  preScript?: string
  postScript?: string
  startLine: number
  endLine: number
}

export function parseHttpFile(filePath: string, source: string): Flow {
  const lines = source.split(/\r?\n/)
  const steps: Step[] = []
  const warnings: ParseWarning[] = []
  let pendingSection: string[] = []
  let fallbackCounter = 0

  let i = 0
  while (i < lines.length) {
    const raw = lines[i]!
    const line = raw
    const trimmed = line.trim()

    // Skip blank lines between steps.
    if (trimmed === '') {
      i += 1
      continue
    }

    // Separator line `### <title>` opens a new step.
    const sepMatch = SEPARATOR_RE.exec(line)
    if (sepMatch) {
      const { step, nextIndex } = readStep(
        lines,
        i,
        sepMatch[1]!,
        pendingSection,
        filePath,
        warnings
      )
      const finalised = finaliseStep(step)
      if (finalised) {
        pendingSection = []
        if (!finalised.num) {
          fallbackCounter += 1
          finalised.num = String(fallbackCounter)
        } else if (!step.num) {
          fallbackCounter += 1
          finalised.num = String(fallbackCounter)
        }
        steps.push(finalised)
      } else if (step.title || step.section) {
        // Carry banner `###` text into the next step's section.
        const carry = [step.section ?? '', step.title ?? '']
          .filter(Boolean)
          .join('\n')
        if (carry) pendingSection.push(carry)
      }
      i = nextIndex
      continue
    }

    // Banner/comment lines accumulate until the next `###`.
    // Rider accepts both `#` and `//` as comment markers.
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
      pendingSection.push(trimmed.replace(/^(#+|\/\/)\s?/, ''))
      i += 1
      continue
    }

    // A bare request without a preceding `###` — tolerate it by synthesising
    // a section boundary. This matches what Rider does for simple files.
    const stripped = trimmed.replace(HTTP_VERSION_RE, '')
    if (
      METHOD_RE.test(stripped) ||
      PRE_OPEN_RE.test(trimmed) ||
      SHORT_URL_RE.test(stripped)
    ) {
      const { step, nextIndex } = readStep(
        lines,
        i - 1 < 0 ? i : i - 1,
        '',
        pendingSection,
        filePath,
        warnings,
        /*noSeparator*/ true
      )
      const finalised = finaliseStep(step)
      if (finalised) {
        pendingSection = []
        if (!finalised.num) {
          fallbackCounter += 1
          finalised.num = String(fallbackCounter)
        } else if (!step.num) {
          fallbackCounter += 1
          finalised.num = String(fallbackCounter)
        }
        steps.push(finalised)
      } else if (step.title || step.section) {
        // Carry banner `###` text into the next step's section.
        const carry = [step.section ?? '', step.title ?? '']
          .filter(Boolean)
          .join('\n')
        if (carry) pendingSection.push(carry)
      }
      i = nextIndex
      continue
    }

    // Anything else at the top level is noise — warn once, skip.
    warnings.push({
      line: i + 1,
      message: `Ignoring unrecognised top-level line: ${trimmed.slice(0, 60)}`
    })
    i += 1
  }

  return { filePath, steps, warnings }
}

function finaliseStep(s: WorkingStep): Step | null {
  // Empty/banner-only `###` blocks — drop silently. Callers have already
  // captured useful comment text into `section`, which will attach to the
  // next real step via the pendingSection buffer.
  if (!s.method) return null
  return {
    num: s.num!,
    title: s.title,
    section: s.section ?? undefined,
    method: s.method,
    url: s.url,
    headers: s.headers,
    body: s.body,
    preScript: s.preScript,
    postScript: s.postScript,
    sourceRange: { startLine: s.startLine, endLine: s.endLine }
  }
}

function readStep(
  lines: string[],
  startIndex: number,
  headerTitle: string,
  section: string[],
  filePath: string,
  warnings: ParseWarning[],
  noSeparator = false
): { step: WorkingStep; nextIndex: number } {
  const step: WorkingStep = {
    num: null,
    title: '',
    section: section.length > 0 ? section.join('\n') : null,
    method: null,
    url: '',
    headers: [],
    body: { kind: 'none' },
    startLine: startIndex + 1,
    endLine: startIndex + 1
  }

  // Parse `<num> <title>` if present.
  if (!noSeparator) {
    const numMatch = STEP_NUM_RE.exec(headerTitle.trim())
    if (numMatch) {
      step.num = numMatch[1]!
      step.title = numMatch[2]!.trim()
    } else {
      step.title = headerTitle.trim()
    }
  }

  let i = noSeparator ? startIndex : startIndex + 1

  // Phase: pre-script.
  i = skipBlankAndComments(lines, i)
  if (i < lines.length && PRE_OPEN_RE.test(lines[i]!)) {
    const { source, nextIndex } = readScript(
      lines,
      i + 1,
      filePath,
      'pre-request'
    )
    step.preScript = source
    i = nextIndex
  }

  // Phase: request line.
  i = skipBlankAndComments(lines, i)
  if (i >= lines.length) {
    step.endLine = i
    step.method = null // signal: empty step
    return { step, nextIndex: i }
  }
  const requestLine = lines[i]!
  if (SEPARATOR_RE.test(requestLine)) {
    // Empty step (just `###` with no body) — common for banner `###` lines.
    step.endLine = i
    step.method = null
    return { step, nextIndex: i }
  }
  const stripped = requestLine.trim().replace(HTTP_VERSION_RE, '')
  const methodMatch = METHOD_RE.exec(stripped)
  if (methodMatch) {
    step.method = methodMatch[1] as HttpMethod
    step.url = methodMatch[2]!.trim()
  } else if (SHORT_URL_RE.test(stripped)) {
    // Short-form GET: bare URL with no method.
    step.method = 'GET'
    step.url = stripped
  } else {
    throw new ParseError(
      `Expected request line "METHOD URL" but got: ${requestLine.trim().slice(0, 80)}`,
      i + 1,
      filePath
    )
  }
  i += 1

  // URL continuation lines — indented (leading whitespace) and do not look
  // like a `Key: Value` header. Concatenate onto the URL verbatim (Rider
  // strips the newlines and joins the fragments).
  while (i < lines.length) {
    const next = lines[i]!
    if (next.trim() === '') break
    if (!/^\s+/.test(next)) break
    if (HEADER_RE.test(next.trim())) break
    step.url += next.trim()
    i += 1
  }

  // Phase: headers — until blank line or body token or EOF.
  while (i < lines.length) {
    const raw = lines[i]!
    const trimmed = raw.trim()
    if (trimmed === '') {
      i += 1
      break
    }
    if (SEPARATOR_RE.test(raw) || POST_OPEN_RE.test(raw)) break
    const h = HEADER_RE.exec(trimmed)
    if (!h) {
      throw new ParseError(
        `Expected header "Key: value" but got: ${trimmed.slice(0, 80)}`,
        i + 1,
        filePath
      )
    }
    step.headers.push({ name: h[1]!, value: h[2]!.trim() })
    i += 1
  }

  // Phase: body — gather until next step/post/EOF.
  const bodyLines: string[] = []
  while (i < lines.length) {
    const raw = lines[i]!
    if (SEPARATOR_RE.test(raw) || POST_OPEN_RE.test(raw)) break
    bodyLines.push(raw)
    i += 1
  }
  // Trim leading/trailing blanks.
  while (bodyLines.length > 0 && bodyLines[0]!.trim() === '') bodyLines.shift()
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1]!.trim() === '')
    bodyLines.pop()
  if (bodyLines.length > 0) {
    const first = bodyLines[0]!
    const fileMatch = FILE_BODY_RE.exec(first.trim())
    if (bodyLines.length === 1 && fileMatch) {
      step.body = { kind: 'file', path: fileMatch[1]!.trim() }
    } else {
      step.body = { kind: 'text', text: bodyLines.join('\n') }
    }
  }

  // Phase: post-script.
  i = skipBlankLines(lines, i)
  if (i < lines.length && POST_OPEN_RE.test(lines[i]!)) {
    const { source, nextIndex } = readScript(
      lines,
      i + 1,
      filePath,
      'response-handler'
    )
    step.postScript = source
    i = nextIndex
  }

  step.endLine = i
  return { step, nextIndex: i }
}

function skipBlankLines(lines: string[], i: number): number {
  while (i < lines.length && lines[i]!.trim() === '') i += 1
  return i
}

/** Skip blank lines AND `#`/`//` comment lines (single-line only — `##`
 *  banners are also accepted since they're just `#` runs).
 *  Does NOT skip `###` (that's a separator). */
function skipBlankAndComments(lines: string[], i: number): number {
  while (i < lines.length) {
    const t = lines[i]!.trim()
    if (t === '') {
      i += 1
      continue
    }
    // Separator '###' must stop the skip.
    if (t.startsWith('###')) return i
    if (t.startsWith('#') || t.startsWith('//')) {
      i += 1
      continue
    }
    return i
  }
  return i
}

function readScript(
  lines: string[],
  startIndex: number,
  filePath: string,
  kind: string
): { source: string; nextIndex: number } {
  const buf: string[] = []
  let i = startIndex
  while (i < lines.length) {
    if (SCRIPT_CLOSE_RE.test(lines[i]!)) {
      return { source: buf.join('\n'), nextIndex: i + 1 }
    }
    buf.push(lines[i]!)
    i += 1
  }
  throw new ParseError(
    `Unterminated ${kind} script — missing %}`,
    startIndex,
    filePath
  )
}
