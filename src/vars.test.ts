import { expect, test } from 'bun:test'
import type { ResolvedEnv } from './env.js'
import { createScope, substitute, VarResolutionError } from './vars.js'

const env: ResolvedEnv = {
  name: 'local',
  vars: {
    baseurl: 'http://localhost:8080',
    employee: { id: 'ee_1', tags: ['x', 'y'] }
  },
  auth: {
    admin_auth: { type: 'Mock', token: 'mocked-{{baseurl}}' },
    cognito: { type: 'OAuth2' }
  },
  sources: []
}

test('substitutes simple env vars', () => {
  const out = substitute('GET {{baseurl}}/ping', createScope(env))
  expect(out).toBe('GET http://localhost:8080/ping')
})

test('resolves nested paths and indexes', () => {
  const out = substitute(
    '{{employee.id}}/{{employee.tags[1]}}',
    createScope(env)
  )
  expect(out).toBe('ee_1/y')
})

test('globals override env when both present', () => {
  const scope = createScope(env, { baseurl: 'http://override' })
  expect(substitute('{{baseurl}}', scope)).toBe('http://override')
})

test('$timestamp built-in', () => {
  const out = substitute('{{$timestamp}}', createScope(env))
  expect(/^\d+$/.test(out)).toBe(true)
})

test('$uuid built-in', () => {
  const out = substitute('{{$uuid}}', createScope(env))
  expect(/^[0-9a-f-]{36}$/.test(out)).toBe(true)
})

test('$random.integer returns a number in range', () => {
  for (let i = 0; i < 20; i++) {
    const out = Number(
      substitute('{{$random.integer(1, 5)}}', createScope(env))
    )
    expect(out).toBeGreaterThanOrEqual(1)
    expect(out).toBeLessThanOrEqual(5)
  }
})

test('$auth.token for mock resolves recursively', () => {
  const out = substitute('{{$auth.token("admin_auth")}}', createScope(env))
  expect(out).toBe('mocked-http://localhost:8080')
})

test('$auth.token for OAuth2 without private token throws clear error', () => {
  expect(() =>
    substitute('{{$auth.token("cognito")}}', createScope(env))
  ).toThrow(/private env file/)
})

test('unknown variable throws', () => {
  expect(() => substitute('{{nope}}', createScope(env))).toThrow(
    VarResolutionError
  )
})
