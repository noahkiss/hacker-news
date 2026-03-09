import './style.css'

const API = 'https://api.hackerwebapp.com'
const HN_API = 'https://hacker-news.firebaseio.com/v0'

// --- Visited tracking (localStorage) ---

const VISITED_KEY = 'hn-visited'
const visited = new Set(JSON.parse(localStorage.getItem(VISITED_KEY) || '[]'))

function markVisited(id) {
  visited.add(String(id))
  const arr = [...visited]
  if (arr.length > 2000) arr.splice(0, arr.length - 2000)
  localStorage.setItem(VISITED_KEY, JSON.stringify(arr))
}

function isVisited(id) { return visited.has(String(id)) }

// --- Routing ---

function getRoute() {
  const hash = location.hash.slice(1) || ''
  const [path, ...rest] = hash.split('/')
  if (path === 'item') return { view: 'item', id: rest[0] }
  if (path === 'user') return { view: 'user', id: rest[0] }
  const params = new URLSearchParams(hash.split('?')[1])
  const filter = params.get('f') || 'top20'
  return { view: 'home', filter }
}

// --- Nav ---

function renderNav(filter) {
  const filters = [
    ['top10', 'top 10'],
    ['top20', 'top 20'],
    ['top50', 'top 50%'],
    ['all', 'all'],
  ]
  document.getElementById('nav').innerHTML = `
    <a class="logo" href="#">HN</a>
    ${filters.map(([key, label]) =>
      `<a href="#?f=${key}" class="filter-pill${filter === key ? ' active' : ''}">${label}</a>`
    ).join('')}
  `
}

// --- API ---

async function fetchJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

// --- Helpers ---

function esc(s) {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

function domain(url) {
  if (!url) return ''
  try { return new URL(url).hostname.replace('www.', '') } catch { return '' }
}

function timeAgo(epoch) {
  const secs = Math.floor(Date.now() / 1000) - epoch
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

// --- User colors ---

const ADMIN_COLOR = '#f38ba8'
const NEWBIE_COLOR = '#a6e3a1'
const ADMINS = new Set(['dang', 'tomhow'])

const USER_COLORS = [
  '#f5c2e7', '#cba6f7', '#fab387', '#f9e2af', '#94e2d5', '#89dceb',
  '#74c7ec', '#89b4fa', '#b4befe', '#f5e0dc', '#f2cdcd', '#eba0ac',
]

function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

let userColorMap = new Map()
let newAccountSet = new Set()

function getUserColor(username, ancestorUsers) {
  if (!username) return USER_COLORS[0]
  if (userColorMap.has(username)) return userColorMap.get(username)
  if (ADMINS.has(username)) { userColorMap.set(username, ADMIN_COLOR); return ADMIN_COLOR }
  if (newAccountSet.has(username)) { userColorMap.set(username, NEWBIE_COLOR); return NEWBIE_COLOR }

  let idx = hashStr(username) % USER_COLORS.length
  const ancestorColors = new Set(
    ancestorUsers.filter(u => userColorMap.has(u)).map(u => userColorMap.get(u))
  )
  let attempts = 0
  while (ancestorColors.has(USER_COLORS[idx]) && attempts < USER_COLORS.length) {
    idx = (idx + 1) % USER_COLORS.length
    attempts++
  }
  userColorMap.set(username, USER_COLORS[idx])
  return USER_COLORS[idx]
}

function getUserPrefix(username) {
  if (ADMINS.has(username)) return '<span class="user-badge admin">[A]</span> '
  if (newAccountSet.has(username)) return '<span class="user-badge newbie">[N]</span> '
  return ''
}

// --- New account detection ---

function collectUsernames(comments) {
  const users = new Set()
  for (const c of comments || []) {
    if (c.user) users.add(c.user)
    for (const u of collectUsernames(c.comments)) users.add(u)
  }
  return users
}

async function fetchNewAccounts(usernames) {
  const twoWeeksAgo = Math.floor(Date.now() / 1000) - 14 * 86400
  const newAccounts = new Set()
  const batches = [...usernames]
  for (let i = 0; i < batches.length; i += 20) {
    const batch = batches.slice(i, i + 20)
    const results = await Promise.allSettled(
      batch.map(u => fetchJSON(`${HN_API}/user/${u}.json`))
    )
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && r.value.created > twoWeeksAgo)
        newAccounts.add(r.value.id)
    }
  }
  return newAccounts
}

function markNewAccounts(newAccounts, item) {
  newAccountSet = newAccounts
  userColorMap = new Map()
  const el = document.querySelector('.comments-container')
  if (el) el.innerHTML = renderComments(item.comments)
}

// --- Home feed: chronological timeline with points-based filtering ---
//
// Modeled after hckrnews.com:
// - Stories sorted by time (newest first)
// - Time dividers at 6-hour boundaries (morning/afternoon/evening/night)
// - Filter determines minimum points threshold:
//   top10: only show if story is in the top 10 by points for its day-window
//   top20: top 20
//   top50: top 50%
//   all: everything
// - Infinite scroll loads older stories

let homeStories = []     // all fetched stories, sorted by time desc
let homeFilter = 'top20'
let homeRendered = 0
let homeFetching = false
let homeExhausted = false
let homeObserver = null
const HOME_CHUNK = 30

// Fetch story IDs from top + best + new, dedupe
async function fetchStoryIds() {
  const [topIds, bestIds, newIds] = await Promise.all([
    fetchJSON(`${HN_API}/topstories.json`),
    fetchJSON(`${HN_API}/beststories.json`),
    fetchJSON(`${HN_API}/newstories.json`),
  ])
  const seen = new Set()
  const merged = []
  // best first (quality), then top (trending), then new (fresh)
  for (const id of [...bestIds, ...topIds, ...newIds]) {
    if (!seen.has(id)) { seen.add(id); merged.push(id) }
  }
  return merged
}

// Fetch all item details in parallel (Firebase API has no rate limit)
async function fetchItems(ids) {
  const results = await Promise.allSettled(
    ids.map(id => fetchJSON(`${HN_API}/item/${id}.json`))
  )
  return results
    .filter(r => r.status === 'fulfilled' && r.value && !r.value.deleted)
    .map(r => r.value)
}

// Group stories by calendar day
function dayKey(epoch) {
  const d = new Date(epoch * 1000)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(epoch) {
  const d = new Date(epoch * 1000)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Per-day threshold, like hckrnews: "top 10" = top 10 stories of each day
function computePerDayThresholds(stories, filter) {
  if (filter === 'all') return null
  const byDay = new Map()
  for (const s of stories) {
    const dk = dayKey(s.time)
    if (!byDay.has(dk)) byDay.set(dk, [])
    byDay.get(dk).push(s)
  }
  const thresholds = new Map()
  for (const [dk, dayStories] of byDay) {
    const sorted = [...dayStories].sort((a, b) => (b.score || 0) - (a.score || 0))
    let n
    if (filter === 'top10') n = 10
    else if (filter === 'top20') n = 20
    else if (filter === 'top50') n = Math.ceil(sorted.length / 2)
    else n = sorted.length
    const idx = Math.min(n - 1, sorted.length - 1)
    thresholds.set(dk, idx >= 0 ? (sorted[idx]?.score || 0) : 0)
  }
  return thresholds
}

function passesFilter(story, thresholds) {
  if (!thresholds) return true
  const dk = dayKey(story.time)
  return (story.score || 0) >= (thresholds.get(dk) || 0)
}

function storyTier(story, stories) {
  const sorted = [...stories].sort((a, b) => (b.score || 0) - (a.score || 0))
  const idx = sorted.indexOf(story)
  const pct = idx / sorted.length
  if (pct < 0.05) return 'hot'
  if (pct < 0.2) return 'warm'
  if (pct < 0.5) return 'mid'
  return 'cool'
}

function renderHomeStory(s, allStories) {
  const v = isVisited(s.id)
  const tier = storyTier(s, allStories)
  const url = s.url || `#item/${s.id}`
  const dom = s.url ? domain(s.url) : ''
  return `
    <li class="story home-story${v ? ' visited' : ''}" data-tier="${tier}" data-id="${s.id}">
      <a href="#item/${s.id}" class="home-stats${v ? ' visited' : ''}">
        <span class="home-points">${s.score || 0}</span>
        <span class="home-comments">${s.descendants || 0}</span>
      </a>
      <div>
        <div class="story-title">
          <a href="${url}" data-id="${s.id}">${esc(s.title)}</a>
          ${dom ? ` <span class="story-domain">(${dom})</span>` : ''}
        </div>
        <div class="story-meta">
          ${s.by ? `<a href="#user/${s.by}">${esc(s.by)}</a> · ` : ''}
          ${timeAgo(s.time)}
          · <a href="#item/${s.id}">${s.descendants || 0} comments</a>
        </div>
      </div>
    </li>`
}

function getVisibleStories(stories, filter) {
  const chrono = [...stories].sort((a, b) => b.time - a.time)
  const thresholds = computePerDayThresholds(stories, filter)
  return chrono.filter(s => passesFilter(s, thresholds))
}

function renderHomeFeed(stories, filter) {
  const visible = getVisibleStories(stories, filter)

  let html = '<ol class="stories home-stories" id="home-list">'
  let lastDay = null

  const toRender = visible.slice(0, HOME_CHUNK)
  homeRendered = toRender.length

  for (const s of toRender) {
    const dk = dayKey(s.time)
    if (dk !== lastDay) {
      html += `<li class="time-divider day-divider">${dayLabel(s.time)}</li>`
      lastDay = dk
    }
    html += renderHomeStory(s, stories)
  }

  html += '</ol>'
  if (toRender.length < visible.length) {
    html += '<div id="home-sentinel" class="home-sentinel"></div>'
  }

  return html
}

function appendHomeChunk() {
  const list = document.getElementById('home-list')
  const sentinel = document.getElementById('home-sentinel')
  if (!list || !sentinel) return

  const visible = getVisibleStories(homeStories, homeFilter)
  const next = visible.slice(homeRendered, homeRendered + HOME_CHUNK)
  if (!next.length) { sentinel.remove(); return }

  const lastRendered = visible[homeRendered - 1]
  let lastDay = lastRendered ? dayKey(lastRendered.time) : null

  let html = ''
  for (const s of next) {
    const dk = dayKey(s.time)
    if (dk !== lastDay) {
      html += `<li class="time-divider day-divider">${dayLabel(s.time)}</li>`
      lastDay = dk
    }
    html += renderHomeStory(s, homeStories)
  }

  list.insertAdjacentHTML('beforeend', html)
  homeRendered += next.length

  if (homeRendered >= visible.length) sentinel.remove()
}

function setupHomeScroll() {
  if (homeObserver) homeObserver.disconnect()
  const sentinel = document.getElementById('home-sentinel')
  if (!sentinel) return

  homeObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) appendHomeChunk()
  }, { rootMargin: '300px' })
  homeObserver.observe(sentinel)
}

// --- Item view ---

function renderComments(comments, ancestors = []) {
  if (!comments || !comments.length) return ''
  return comments.map(c => {
    const color = getUserColor(c.user, ancestors)
    const prefix = getUserPrefix(c.user)
    const nextAncestors = [...ancestors, c.user]
    return `
    <div class="comment${c.dead ? ' dead' : ''}">
      <div class="comment-bar" title="Collapse thread"></div>
      <div class="comment-content">
        <div class="comment-meta">
          ${prefix}<a href="#user/${c.user}" class="comment-user" data-user="${esc(c.user || '')}" style="color: ${color}">${esc(c.user || '[deleted]')}</a>
          ${c.time_ago || ''}
        </div>
        <div class="comment-body">
          <div class="comment-text">${c.content || ''}</div>
          ${renderComments(c.comments, nextAncestors)}
        </div>
      </div>
    </div>`
  }).join('')
}

function renderItem(item) {
  userColorMap = new Map()
  newAccountSet = new Set()
  return `
    <div class="item-header">
      <h1><a href="${item.url || '#'}">${esc(item.title || '')}</a></h1>
      ${item.domain ? `<span class="story-domain">(${esc(item.domain)})</span>` : ''}
      <div class="item-meta">
        ${item.points ?? 0} points
        · <a href="#user/${item.user}">${esc(item.user || '')}</a>
        · ${item.time_ago || ''}
        · <a href="https://news.ycombinator.com/item?id=${item.id}">hn</a>
      </div>
    </div>
    ${item.content ? `<div class="item-text">${item.content}</div>` : ''}
    <div class="comments-container">${renderComments(item.comments)}</div>
  `
}

function renderUser(user) {
  return `
    <div class="item-header">
      <h1>${esc(user.id)}</h1>
      <div class="item-meta">
        ${user.karma ?? 0} karma · created ${user.created || ''}
      </div>
    </div>
    ${user.about ? `<div class="item-text">${user.about}</div>` : ''}
  `
}

// --- Event delegation ---

document.addEventListener('click', (e) => {
  const bar = e.target.closest('.comment-bar')
  if (bar) { bar.closest('.comment').classList.toggle('collapsed'); return }

  const link = e.target.closest('a[data-id]')
  if (link) {
    markVisited(link.dataset.id)
    const story = link.closest('.story')
    if (story) story.classList.add('visited')
    const stats = story?.querySelector('.home-stats')
    if (stats) stats.classList.add('visited')
  }
})

// --- Router ---

async function route() {
  const app = document.getElementById('app')
  const r = getRoute()

  if (homeObserver) { homeObserver.disconnect(); homeObserver = null }

  if (r.view === 'home') {
    renderNav(r.filter)
    homeFilter = r.filter
    app.innerHTML = '<div class="loading">Loading stories…</div>'
    try {
      const ids = await fetchStoryIds()
      homeStories = await fetchItems(ids.slice(0, 300))
      app.innerHTML = renderHomeFeed(homeStories, r.filter)
      setupHomeScroll()
    } catch (e) {
      app.innerHTML = `<div class="error">Failed to load: ${esc(e.message)}</div>`
    }
  } else if (r.view === 'item') {
    renderNav(homeFilter)
    app.innerHTML = '<div class="loading">Loading…</div>'
    try {
      const item = await fetchJSON(`${API}/item/${r.id}`)
      markVisited(r.id)
      app.innerHTML = renderItem(item)
      const usernames = collectUsernames(item.comments)
      if (usernames.size) {
        fetchNewAccounts(usernames).then(na => markNewAccounts(na, item))
      }
    } catch (e) {
      app.innerHTML = `<div class="error">Failed to load item: ${esc(e.message)}</div>`
    }
  } else if (r.view === 'user') {
    renderNav(homeFilter)
    app.innerHTML = '<div class="loading">Loading…</div>'
    try {
      const user = await fetchJSON(`${API}/user/${r.id}`)
      app.innerHTML = renderUser(user)
    } catch (e) {
      app.innerHTML = `<div class="error">Failed to load user: ${esc(e.message)}</div>`
    }
  }
}

window.addEventListener('hashchange', route)
route()
