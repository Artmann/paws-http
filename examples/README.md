# pawsh examples

Demo `.http` flows that hit public APIs — use them for manual testing or
screenshots. They require no local services, just an internet connection.

```sh
# Run everything
pawsh run examples

# Run one file, interactively
pawsh run examples/02-chain.http

# Run a single step non-interactively
pawsh run examples/01-hello.http --only 1.1

# From the picker
pawsh
```

## Files

- `01-hello.http` — single GET + a few assertions
- `02-chain.http` — two steps; the second uses a value captured from the first
- `03-builtins.http` — `{{$uuid}}`, `{{$timestamp}}`,
  `{{$random.integer(a, b)}}`
- `04-failures.http` — one step fails on purpose; good for screenshots of the
  red path

`http-client.env.json` defines one environment, `local`, which points at public
APIs so no local server is needed:

- `jsonplaceholder.typicode.com` — a free read/fake-write JSON placeholder API
- `httpbin.org` — echoes the request back, handy for asserting what we sent
