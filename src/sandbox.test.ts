import { expect, test } from 'bun:test'
import {
  extractScriptImports,
  runPostScript,
  runPreScript,
  ScriptError,
  type ScriptContext
} from './sandbox'

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

test('extractScriptImports strips imports and collects names', () => {
  const src = `
import { a, b as c } from "utilities"
import { d } from "./helpers.js"
client.global.set("x", 1);
`
  const result = extractScriptImports(src)
  expect(result.imports).toEqual([
    {
      source: 'utilities',
      bindings: [
        { exportName: 'a', localName: 'a' },
        { exportName: 'b', localName: 'c' }
      ]
    },
    {
      source: './helpers.js',
      bindings: [{ exportName: 'd', localName: 'd' }]
    }
  ])
  expect(result.stripped).not.toContain('import')
  expect(result.stripped).toContain('client.global.set')
})

test('extractScriptImports rejects default and namespace imports', () => {
  expect(() => extractScriptImports('import x from "utilities"\n')).toThrow(
    ScriptError
  )
  expect(() =>
    extractScriptImports('import * as u from "utilities"\n')
  ).toThrow(ScriptError)
})

test('pre-script can use named imports passed via modules map', () => {
  const c = ctx()
  const greet = (name: string) => `hello ${name}`
  runPreScript(
    `
    import { greet } from "utilities"
    client.global.set("msg", greet("world"));
    `,
    c,
    { utilities: { greet } }
  )
  expect(c.globals.msg).toBe('hello world')
})

test('post-script can use imports from a relative file', () => {
  const c = ctx()
  const upper = (s: string) => s.toUpperCase()
  runPostScript(
    `
    import { upper } from "./helpers.js"
    client.test("upper", function() {
      client.assert(upper(response.body.name) === "ALICE", "nope");
    });
    `,
    c,
    {
      status: 200,
      body: { name: 'alice' },
      headers: {},
      contentType: 'application/json'
    },
    { './helpers.js': { upper } }
  )
  expect(c.tests).toHaveLength(1)
  expect(c.tests[0]!.passed).toBe(true)
})

test('script throws ScriptError when imported module is missing', () => {
  const c = ctx()
  expect(() => runPreScript('import { x } from "utilities"\n', c)).toThrow(
    ScriptError
  )
})

test('script throws ScriptError when an exported name is missing', () => {
  const c = ctx()
  expect(() =>
    runPreScript('import { missing } from "utilities"\n', c, {
      utilities: { other: 1 }
    })
  ).toThrow(/no export "missing"/)
})

test('aliased import binds the alias name', () => {
  const c = ctx()
  runPreScript(
    `
    import { greet as hi } from "utilities"
    client.global.set("msg", hi("ada"));
    `,
    c,
    { utilities: { greet: (n: string) => `hi ${n}` } }
  )
  expect(c.globals.msg).toBe('hi ada')
})
