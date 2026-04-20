import { expect, test } from 'bun:test'
import { parseHttpFile } from './parser.js'

test('short-form GET (bare URL)', () => {
  const src = `### Ping
https://example.com/a
`
  const flow = parseHttpFile('t.http', src)
  expect(flow.steps[0]!.method).toBe('GET')
  expect(flow.steps[0]!.url).toBe('https://example.com/a')
})

test('strips trailing HTTP/1.1 version from request line', () => {
  const src = `### Thing
POST https://example.com/api HTTP/1.1
Content-Type: application/json

{"ok": true}
`
  const flow = parseHttpFile('t.http', src)
  expect(flow.steps[0]!.url).toBe('https://example.com/api')
})

test('URL continuation across indented lines', () => {
  const src = `### Long
GET http://example.com:8080
  /api
  /html
  ?id=123
  &value=content
`
  const flow = parseHttpFile('t.http', src)
  expect(flow.steps[0]!.url).toBe(
    'http://example.com:8080/api/html?id=123&value=content'
  )
})

test('// line comments are treated as banner', () => {
  const src = `// Top-level comment
// Another
### Hit
GET https://example.com/x
`
  const flow = parseHttpFile('t.http', src)
  expect(flow.steps[0]!.section).toContain('Top-level comment')
})
