import { randomUUID } from 'node:crypto'
import type { AuthConfig, ResolvedEnv } from './env.js'

export class VarResolutionError extends Error {}

export interface VarScope {
  /** Environment-level variables (from env.json). */
  env: Record<string, unknown>
  /** Global variables set during the flow by `client.global.set`. */
  globals: Record<string, unknown>
  /** Request-scoped vars set by `request.variables.set` in a pre-script. */
  request: Record<string, unknown>
  auth: Record<string, AuthConfig>
}

export function createScope(
  env: ResolvedEnv,
  globals: Record<string, unknown> = {},
  request: Record<string, unknown> = {}
): VarScope {
  return {
    env: { ...env.vars },
    globals,
    request,
    auth: env.auth
  }
}

/**
 * Substitute `{{…}}` template expressions in a string.
 * Resolves env → globals → request scopes in order, with built-ins
 * recognised by the `$` prefix.
 */
export function substitute(template: string, scope: VarScope): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, expr) => {
    const value = resolveExpression(String(expr).trim(), scope)
    if (value === undefined || value === null) {
      throw new VarResolutionError(
        `Unknown variable: {{${String(expr).trim()}}}`
      )
    }
    return String(value)
  })
}

/** Resolve one `{{…}}` expression body. Returns raw value (may be non-string). */
export function resolveExpression(expr: string, scope: VarScope): unknown {
  if (expr.startsWith('$')) {
    return resolveBuiltin(expr, scope)
  }
  return readPath(expr, scope)
}

function resolveBuiltin(expr: string, scope: VarScope): unknown {
  if (expr === '$timestamp') return Date.now().toString()
  if (expr === '$uuid') return randomUUID()

  const rand = /^\$random\.integer\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/.exec(
    expr
  )
  if (rand) {
    const lo = Number(rand[1]!)
    const hi = Number(rand[2]!)
    return String(Math.floor(Math.random() * (hi - lo + 1)) + lo)
  }

  const auth = /^\$auth\.token\(\s*["']([^"']+)["']\s*\)$/.exec(expr)
  if (auth) {
    const name = auth[1]!
    const cfg = scope.auth[name]
    if (!cfg) {
      throw new VarResolutionError(
        `No auth config named "${name}" in environment.`
      )
    }
    if (cfg.type === 'Mock') {
      return substitute(cfg.token, scope)
    }
    if (cfg.type === 'OAuth2') {
      if (!cfg.privateToken) {
        throw new VarResolutionError(
          `OAuth2 auth "${name}" has no Token set in http-client.private.env.json — pawsh v1 cannot perform the OAuth2 Implicit flow. Paste a bearer token under Security.Auth.${name}.Token in the private env file.`
        )
      }
      return cfg.privateToken
    }
  }

  throw new VarResolutionError(`Unsupported built-in: {{${expr}}}`)
}

function readPath(expr: string, scope: VarScope): unknown {
  // Supports `foo`, `foo.bar.baz`, `foo[0]`, `foo[0].bar`.
  const parts = tokenisePath(expr)
  let cur: unknown = undefined
  const first = parts[0]
  if (!first || first.kind !== 'name') {
    throw new VarResolutionError(`Malformed variable path: ${expr}`)
  }
  cur =
    scope.request[first.name] ??
    scope.globals[first.name] ??
    scope.env[first.name]
  for (let i = 1; i < parts.length; i += 1) {
    if (cur === undefined || cur === null) return undefined
    const p = parts[i]!
    if (p.kind === 'name') {
      cur = (cur as Record<string, unknown>)[p.name]
    } else {
      cur = (cur as unknown[])[p.index]
    }
  }
  return cur
}

type PathPart =
  | { kind: 'name'; name: string }
  | { kind: 'index'; index: number }

function tokenisePath(expr: string): PathPart[] {
  const parts: PathPart[] = []
  let i = 0
  while (i < expr.length) {
    if (expr[i] === '.') {
      i += 1
      continue
    }
    if (expr[i] === '[') {
      const end = expr.indexOf(']', i)
      if (end < 0) throw new VarResolutionError(`Unterminated [ in ${expr}`)
      parts.push({ kind: 'index', index: Number(expr.slice(i + 1, end)) })
      i = end + 1
      continue
    }
    let j = i
    while (j < expr.length && expr[j] !== '.' && expr[j] !== '[') j += 1
    parts.push({ kind: 'name', name: expr.slice(i, j) })
    i = j
  }
  return parts
}
