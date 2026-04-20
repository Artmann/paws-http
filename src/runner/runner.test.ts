import { expect, test } from 'bun:test'
import type { ResolvedEnv } from '../env'
import { parseHttpFile } from '../parser/parser'
import { runFlow } from './runner'

const env: ResolvedEnv = {
  name: 'test',
  vars: { baseurl: 'http://api.test' },
  auth: {},
  sources: []
}

function mockFetch(
  handler: (req: {
    method: string
    url: string
    body?: string
    headers?: Record<string, string>
  }) => {
    status?: number
    body?: unknown
    headers?: Record<string, string>
  }
): typeof fetch {
  return (async (input: unknown, init: unknown) => {
    const url = typeof input === 'string' ? input : String(input)
    const i = (init ?? {}) as RequestInit & { body?: string }
    const result = handler({
      method: i.method ?? 'GET',
      url,
      body: typeof i.body === 'string' ? i.body : undefined,
      headers: i.headers as Record<string, string> | undefined
    })
    const bodyText =
      typeof result.body === 'string'
        ? result.body
        : JSON.stringify(result.body ?? {})
    return new Response(bodyText, {
      status: result.status ?? 200,
      headers: {
        'content-type': 'application/json',
        ...(result.headers ?? {})
      }
    })
  }) as unknown as typeof fetch
}

test('runs a single GET step with passing tests', async () => {
  const flow = parseHttpFile(
    'x.http',
    `### 1.1 Ping
GET {{baseurl}}/ping

> {%
client.test("ok", function() {
  client.assert(response.status === 200, "bad status");
});
%}
`
  )
  const report = await runFlow(flow, {
    env,
    fetcher: mockFetch(() => ({ status: 200, body: { pong: true } }))
  })
  expect(report.status).toBe('pass')
  expect(report.steps[0]!.status).toBe('pass')
  expect(report.steps[0]!.tests[0]!.passed).toBe(true)
})

test('globals set in one step flow through to the next', async () => {
  const flow = parseHttpFile(
    'x.http',
    `### 1.1 Login
POST {{baseurl}}/login

> {%
client.global.set("user_id", response.body.id);
%}

### 1.2 Fetch
GET {{baseurl}}/users/{{user_id}}

> {%
client.test("reads user", function() {
  client.assert(response.status === 200, "nope");
});
%}
`
  )
  const urls: string[] = []
  const report = await runFlow(flow, {
    env,
    fetcher: mockFetch((req) => {
      urls.push(req.url)
      if (req.url.endsWith('/login')) return { body: { id: 'u_123' } }
      return { body: { id: 'u_123', name: 'A' } }
    })
  })
  expect(report.status).toBe('pass')
  expect(urls[1]).toBe('http://api.test/users/u_123')
})

test('marks step failed when a client.assert fails', async () => {
  const flow = parseHttpFile(
    'x.http',
    `### 1.1 Thing
GET {{baseurl}}/thing

> {%
client.test("fails", function() {
  client.assert(response.status === 999, "bad");
});
%}
`
  )
  const report = await runFlow(flow, {
    env,
    fetcher: mockFetch(() => ({ status: 200, body: {} }))
  })
  expect(report.status).toBe('fail')
  expect(report.steps[0]!.status).toBe('fail')
  expect(report.steps[0]!.tests[0]!.passed).toBe(false)
})

test('fail-fast skips remaining steps', async () => {
  const flow = parseHttpFile(
    'x.http',
    `### 1.1 A
GET {{baseurl}}/a

> {%
client.test("x", function() { client.assert(false, "stop"); });
%}

### 1.2 B
GET {{baseurl}}/b
`
  )
  const report = await runFlow(flow, {
    env,
    failFast: true,
    fetcher: mockFetch(() => ({ status: 200, body: {} }))
  })
  expect(report.steps[0]!.status).toBe('fail')
  expect(report.steps[1]!.status).toBe('skipped')
})

test('onlySteps filters by num', async () => {
  const flow = parseHttpFile(
    'x.http',
    `### 1.1 A
GET {{baseurl}}/a

### 1.2 B
GET {{baseurl}}/b
`
  )
  const seen: string[] = []
  await runFlow(flow, {
    env,
    onlySteps: new Set(['1.2']),
    fetcher: mockFetch((req) => {
      seen.push(req.url)
      return { body: {} }
    })
  })
  expect(seen).toEqual(['http://api.test/b'])
})

test('network error is captured as step error', async () => {
  const flow = parseHttpFile(
    'x.http',
    `### 1.1 Oops
GET {{baseurl}}/x
`
  )
  const report = await runFlow(flow, {
    env,
    fetcher: (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
  })
  expect(report.steps[0]!.status).toBe('error')
  expect(report.steps[0]!.error?.phase).toBe('fetch')
  expect(report.steps[0]!.error?.message).toContain('ECONNREFUSED')
})
