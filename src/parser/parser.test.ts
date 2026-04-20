import { expect, test } from 'bun:test'
import { parseHttpFile } from './parser.js'

test('parses a single GET request', () => {
  const src = `### Ping
GET https://example.com/health
Accept: application/json
`
  const flow = parseHttpFile('test.http', src)
  expect(flow.steps).toHaveLength(1)
  const s = flow.steps[0]!
  expect(s.method).toBe('GET')
  expect(s.url).toBe('https://example.com/health')
  expect(s.title).toBe('Ping')
  expect(s.num).toBe('1')
  expect(s.headers).toEqual([{ name: 'Accept', value: 'application/json' }])
  expect(s.body).toEqual({ kind: 'none' })
})

test('extracts numeric step labels like `### 1.1 Title`', () => {
  const src = `### 1.1 Create Platform
POST https://api/platforms
`
  const flow = parseHttpFile('t.http', src)
  expect(flow.steps[0]!.num).toBe('1.1')
  expect(flow.steps[0]!.title).toBe('Create Platform')
})

test('parses JSON body between headers and post-script', () => {
  const src = `### 1.1 Make widget
POST https://api/widgets
Content-Type: application/json

{
  "name": "foo",
  "tags": ["a", "b"]
}

> {%
client.test("ok", function() {
  client.assert(response.status === 200, "bad status");
});
%}
`
  const flow = parseHttpFile('t.http', src)
  const s = flow.steps[0]!
  expect(s.body.kind).toBe('text')
  if (s.body.kind === 'text') {
    expect(JSON.parse(s.body.text).name).toBe('foo')
  }
  expect(s.postScript).toContain('client.test')
  expect(s.postScript).toContain('client.assert')
  expect(s.postScript).not.toContain('%}')
})

test('parses pre-request script with client.global.set', () => {
  const src = `### 1.1 Setup
< {%
client.global.clearAll();
client.global.set("baseurl", "http://localhost:8080");
%}
POST {{baseurl}}/things
`
  const flow = parseHttpFile('t.http', src)
  const s = flow.steps[0]!
  expect(s.preScript).toContain('client.global.set')
  expect(s.url).toBe('{{baseurl}}/things')
})

test('handles multiple steps and banner comments', () => {
  const src = `## ============================================================================
## SECTION 1: Setup
## ============================================================================

### 1.1 Create A
POST https://api/a

### 1.2 Create B
POST https://api/b
`
  const flow = parseHttpFile('t.http', src)
  expect(flow.steps).toHaveLength(2)
  expect(flow.steps[0]!.section).toContain('SECTION 1: Setup')
  expect(flow.steps[0]!.title).toBe('Create A')
  expect(flow.steps[1]!.title).toBe('Create B')
})

test('handles file-reference body `< ./path`', () => {
  const src = `### Upload
POST https://api/upload
Content-Type: text/csv

< ./data.csv
`
  const flow = parseHttpFile('t.http', src)
  const body = flow.steps[0]!.body
  expect(body.kind).toBe('file')
  if (body.kind === 'file') expect(body.path).toBe('./data.csv')
})

test('parses a multi-section fixture like a real-world flow', () => {
  const src = `## ============================================================================
## SECTION 1: Setup
## ============================================================================

### 1.1 Create Platform
< {%
    client.global.clearAll();
    client.global.set("baseurl", "http://localhost:8080");
%}
POST {{baseurl}}/platforms
Authorization: Bearer {{$auth.token("admin_auth")}}
Content-Type: application/json

{
  "name": "Test Platform",
  "slug": "test-{{$timestamp}}"
}

> {%
    client.test("Create platform - success", function() {
        client.assert(response.status === 200, "status");
        client.assert(response.body.id, "no id");
    });
    client.global.set("platform_id", response.body.id);
%}

### 1.2 Fetch Platform
GET {{baseurl}}/platforms/{{platform_id}}
Accept: application/json

> {%
    client.test("Fetch platform - success", function() {
        client.assert(response.status === 200, "status");
    });
%}
`
  const flow = parseHttpFile('t.http', src)
  expect(flow.steps).toHaveLength(2)
  const first = flow.steps[0]!
  expect(first.num).toBe('1.1')
  expect(first.method).toBe('POST')
  expect(first.section).toContain('SECTION 1')
  expect(first.preScript).toContain('client.global.clearAll')
  expect(first.postScript).toContain('client.test')
  expect(flow.steps[1]!.url).toBe('{{baseurl}}/platforms/{{platform_id}}')
})

test('unterminated script throws a helpful error', () => {
  const src = `### bad
POST https://api/x

> {%
client.test("x", () => {});
`
  expect(() => parseHttpFile('t.http', src)).toThrow(/Unterminated/)
})
