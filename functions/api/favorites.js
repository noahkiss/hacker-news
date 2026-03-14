// GET /api/favorites — returns all favorite story IDs
// POST /api/favorites — add a favorite
// DELETE /api/favorites — remove a favorite
// Body: { id: string }

const KEY = 'favorites'

export async function onRequestGet({ env }) {
  const ids = await env.HN_KV.get(KEY, 'json') || []
  return Response.json({ ids })
}

export async function onRequestPost({ request, env }) {
  const { id } = await request.json()
  if (!id) return new Response('Bad request', { status: 400 })

  const ids = await env.HN_KV.get(KEY, 'json') || []
  if (!ids.includes(String(id))) ids.push(String(id))
  await env.HN_KV.put(KEY, JSON.stringify(ids))
  return Response.json({ ok: true })
}

export async function onRequestDelete({ request, env }) {
  const { id } = await request.json()
  if (!id) return new Response('Bad request', { status: 400 })

  const ids = await env.HN_KV.get(KEY, 'json') || []
  const filtered = ids.filter(i => i !== String(id))
  await env.HN_KV.put(KEY, JSON.stringify(filtered))
  return Response.json({ ok: true })
}
