// GET /api/visited — returns merged visited IDs from last 7 days
// POST /api/visited — writes today's visited IDs
// Body: { ids: [string] }

const DAYS_TO_KEEP = 7

function dateKey(daysAgo = 0) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return `visited:${d.toISOString().slice(0, 10)}`
}

export async function onRequestGet({ env }) {
  const keys = Array.from({ length: DAYS_TO_KEEP }, (_, i) => dateKey(i))
  const results = await Promise.all(keys.map(k => env.HN_KV.get(k, 'json')))
  const ids = [...new Set(results.flatMap(r => r || []))]
  return Response.json({ ids })
}

export async function onRequestPost({ request, env }) {
  const { ids } = await request.json()
  if (!Array.isArray(ids)) return new Response('Bad request', { status: 400 })

  const key = dateKey(0)
  const existing = await env.HN_KV.get(key, 'json') || []
  const merged = [...new Set([...existing, ...ids])]

  // TTL: 30 days — old keys expire automatically
  await env.HN_KV.put(key, JSON.stringify(merged), { expirationTtl: 30 * 86400 })
  return Response.json({ ok: true, count: merged.length })
}
