// Tiny mock server for end-to-end smoke testing.
const server = Bun.serve({
  port: Number(process.env.PORT ?? 9753),
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/ping') {
      return Response.json({ id: 'plt_1', pong: true })
    }
    if (url.pathname.startsWith('/platforms/')) {
      const id = url.pathname.split('/')[2]
      return Response.json({ id })
    }
    return new Response('not found', { status: 404 })
  }
})

console.log(`mock listening on ${server.url}`)
