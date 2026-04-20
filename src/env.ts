import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface MockAuth {
  type: 'Mock'
  token: string
}
export interface OAuth2Auth {
  type: 'OAuth2'
  privateToken?: string
  clientId?: string
  authUrl?: string
  scope?: string
}
export type AuthConfig = MockAuth | OAuth2Auth

export interface ResolvedEnv {
  name: string
  vars: Record<string, unknown>
  auth: Record<string, AuthConfig>
  /** Absolute paths we loaded from, for diagnostics. */
  sources: string[]
}

export interface EnvFiles {
  publicPath?: string
  privatePath?: string
  publicEnv: Record<string, Record<string, unknown>>
  privateEnv: Record<string, Record<string, unknown>>
}

export async function findEnvFiles(httpFilePath: string): Promise<EnvFiles> {
  const publicPath = await walkUpFor(httpFilePath, 'http-client.env.json')
  const privatePath = await walkUpFor(
    httpFilePath,
    'http-client.private.env.json'
  )
  const publicEnv = publicPath
    ? ((await readJson(publicPath)) as EnvFiles['publicEnv'])
    : {}
  const privateEnv = privatePath
    ? ((await readJson(privatePath)) as EnvFiles['privateEnv'])
    : {}
  return { publicPath, privatePath, publicEnv, privateEnv }
}

export function listEnvironments(files: EnvFiles): string[] {
  const names = new Set<string>([
    ...Object.keys(files.publicEnv),
    ...Object.keys(files.privateEnv)
  ])
  return [...names]
}

export function resolveEnv(files: EnvFiles, name: string): ResolvedEnv {
  const pub = files.publicEnv[name] ?? {}
  const priv = files.privateEnv[name] ?? {}
  const merged = deepMerge(pub, priv)
  const { vars, auth } = splitSecurity(merged)
  const sources: string[] = []
  if (files.publicPath) sources.push(files.publicPath)
  if (files.privatePath) sources.push(files.privatePath)
  return { name, vars, auth, sources }
}

async function walkUpFor(
  startFile: string,
  targetName: string
): Promise<string | undefined> {
  let dir = dirname(startFile)
  // Stop when we hit the filesystem root.
  while (true) {
    const candidate = join(dir, targetName)
    if (await exists(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readJson(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf-8')
  return JSON.parse(text)
}

function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a }
  for (const [k, v] of Object.entries(b)) {
    const existing = out[k]
    if (isObject(existing) && isObject(v)) {
      out[k] = deepMerge(existing, v)
    } else {
      out[k] = v
    }
  }
  return out
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function splitSecurity(merged: Record<string, unknown>): {
  vars: Record<string, unknown>
  auth: Record<string, AuthConfig>
} {
  const vars: Record<string, unknown> = {}
  const auth: Record<string, AuthConfig> = {}

  for (const [k, v] of Object.entries(merged)) {
    if (k === 'Security' && isObject(v) && isObject(v.Auth)) {
      for (const [authName, config] of Object.entries(v.Auth)) {
        if (!isObject(config)) continue
        const type = config.Type
        if (type === 'Mock') {
          auth[authName] = {
            type: 'Mock',
            token: String(config.Token ?? '')
          }
        } else if (type === 'OAuth2') {
          auth[authName] = {
            type: 'OAuth2',
            privateToken:
              typeof config.Token === 'string' ? config.Token : undefined,
            clientId:
              typeof config['Client ID'] === 'string'
                ? (config['Client ID'] as string)
                : undefined,
            authUrl:
              typeof config['Auth URL'] === 'string'
                ? (config['Auth URL'] as string)
                : undefined,
            scope:
              typeof config.Scope === 'string'
                ? (config.Scope as string)
                : undefined
          }
        }
      }
      continue
    }
    vars[k] = v
  }

  return { vars, auth }
}
