import { expect, test } from 'bun:test'
import {
  runPostScript,
  runPreScript,
  UtilitiesNotSupportedError,
  type ScriptContext
} from './sandbox.js'

function ctx(): ScriptContext {
  return { globals: {}, request: {}, tests: [], logs: [] }
}

test('pre-script can set globals', () => {
  const c = ctx()
  runPreScript('client.global.set("x", 42);', c)
  expect(c.globals.x).toBe(42)
})

test('post-script runs client.test and captures passes/failures', () => {
  const c = ctx()
  const response = {
    status: 200,
    body: { id: 'plt_1' },
    headers: {},
    contentType: 'application/json'
  }
  runPostScript(
    `
    client.test("status ok", function() {
      client.assert(response.status === 200, "wrong status");
    });
    client.test("has id", function() {
      client.assert(response.body.id === "plt_1", "wrong id");
    });
    client.test("intentional fail", function() {
      client.assert(false, "boom");
    });
    client.global.set("platform_id", response.body.id);
    `,
    c,
    response
  )
  expect(c.tests).toHaveLength(3)
  expect(c.tests[0]!.passed).toBe(true)
  expect(c.tests[1]!.passed).toBe(true)
  expect(c.tests[2]!.passed).toBe(false)
  expect(c.tests[2]!.message).toBe('boom')
  expect(c.globals.platform_id).toBe('plt_1')
})

test('request.variables.set writes to request scope', () => {
  const c = ctx()
  runPreScript('request.variables.set("addr", {city: "Lisbon"});', c)
  expect(c.request.addr).toEqual({ city: 'Lisbon' })
})

test('clearAll empties globals', () => {
  const c = ctx()
  c.globals.a = 1
  c.globals.b = 2
  runPreScript('client.global.clearAll();', c)
  expect(Object.keys(c.globals)).toHaveLength(0)
})

test('import from utilities throws UtilitiesNotSupportedError with line', () => {
  const c = ctx()
  const src = `
// just some comment
import {wait} from "utilities"
client.global.set("x", 1);
`
  expect(() => runPreScript(src, c)).toThrow(UtilitiesNotSupportedError)
})
