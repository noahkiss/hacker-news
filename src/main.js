import './style.css'

const API = 'https://api.hackerwebapp.com'
const HN_API = 'https://hacker-news.firebaseio.com/v0'

// --- Visited tracking (localStorage + KV sync) ---

const VISITED_KEY = 'hn-visited'
const visited = new Set(JSON.parse(localStorage.getItem(VISITED_KEY) || '[]'))
let visitedPendingSync = []

function saveVisitedLocal() {
  const arr = [...visited]
  if (arr.length > 2000) arr.splice(0, arr.length - 2000)
  localStorage.setItem(VISITED_KEY, JSON.stringify(arr))
}

function markVisited(id) {
  visited.add(String(id))
  visitedPendingSync.push(String(id))
  saveVisitedLocal()
}

function isVisited(id) { return visited.has(String(id)) }

// Sync visited with KV — pull remote, merge, push new
async function syncVisited() {
  try {
    const res = await fetch('/api/visited')
    if (res.ok) {
      const { ids } = await res.json()
      for (const id of ids) visited.add(id)
      saveVisitedLocal()
    }
  } catch { /* offline — skip */ }
}

async function pushVisited() {
  if (!visitedPendingSync.length) return
  const ids = [...visitedPendingSync]
  visitedPendingSync = []
  try {
    await fetch('/api/visited', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
  } catch {
    visitedPendingSync.push(...ids) // retry next time
  }
}

// Push visited on page unload and periodically
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') pushVisited()
})
setInterval(pushVisited, 60000)

// --- Favorites (localStorage + KV sync) ---

const FAVORITES_KEY = 'hn-favorites'
const favorites = new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'))

function saveFavoritesLocal() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]))
}

function isFavorite(id) { return favorites.has(String(id)) }

async function toggleFavorite(id) {
  const sid = String(id)
  const adding = !favorites.has(sid)
  if (adding) favorites.add(sid)
  else favorites.delete(sid)
  saveFavoritesLocal()
  try {
    await fetch('/api/favorites', {
      method: adding ? 'POST' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sid }),
    })
  } catch { /* offline — localStorage is source of truth */ }
  return adding
}

async function syncFavorites() {
  try {
    const res = await fetch('/api/favorites')
    if (res.ok) {
      const { ids } = await res.json()
      for (const id of ids) favorites.add(id)
      saveFavoritesLocal()
    }
  } catch { /* offline */ }
}

// --- Story cache (localStorage, 20 min TTL) ---

const CACHE_KEY = 'hn-stories-cache'
const CACHE_TTL = 20 * 60 * 1000 // 20 minutes

function getCachedStories() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { ts, stories } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL) return null
    return stories
  } catch { return null }
}

function setCachedStories(stories) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), stories }))
  } catch { /* quota exceeded — ignore */ }
}

// --- Routing ---

function getRoute() {
  const hash = location.hash.slice(1) || ''
  const [path, ...rest] = hash.split('/')
  if (path === 'item') return { view: 'item', id: rest[0] }
  if (path === 'user') return { view: 'user', id: rest[0] }
  if (path === 'favorites') return { view: 'favorites' }
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
    <a href="#favorites" class="filter-pill${filter === 'favorites' ? ' active' : ''}">saved</a>
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

// --- Story fetching via hackerwebapp (full objects, 30/page) ---

function normalizeStory(s) {
  return {
    id: s.id,
    title: s.title,
    url: s.url,
    score: s.points || 0,
    by: s.user || '',
    time: s.time,
    descendants: s.comments_count || 0,
  }
}

function storyTag(title) {
  if (/^Ask HN[:]/i.test(title)) return '<span class="story-tag ask">A</span> '
  if (/^Show HN[:]/i.test(title)) return '<span class="story-tag show">S</span> '
  return ''
}

function cleanTitle(title) {
  return title.replace(/^(Ask|Show) HN:\s*/i, '')
}

async function fetchStories() {
  const pages = await Promise.all([
    ...Array.from({ length: 5 }, (_, i) => fetchJSON(`${API}/news?page=${i + 1}`)),
    ...Array.from({ length: 5 }, (_, i) => fetchJSON(`${API}/best?page=${i + 1}`)),
  ])

  const seen = new Set()
  const stories = []
  for (const page of pages) {
    for (const s of page) {
      if (!seen.has(s.id)) {
        seen.add(s.id)
        stories.push(normalizeStory(s))
      }
    }
  }
  return stories
}

// --- Home feed ---

let homeStories = []
let homeFilter = 'top20'
let homeRendered = 0
let homeObserver = null
let homeLoaded = false
let savedScrollY = 0
const HOME_CHUNK = 30

function dayKey(epoch) {
  const d = new Date(epoch * 1000)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(epoch) {
  const d = new Date(epoch * 1000)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function computeFilteredIds(stories, filter) {
  if (filter === 'all') return null
  const byDay = new Map()
  for (const s of stories) {
    const dk = dayKey(s.time)
    if (!byDay.has(dk)) byDay.set(dk, [])
    byDay.get(dk).push(s)
  }

  // Compute a quality threshold from completed days (not today).
  // This prevents early-morning "top 10" from showing 2-point stories.
  const today = dayKey(Math.floor(Date.now() / 1000))
  const pastDays = [...byDay.entries()].filter(([dk]) => dk !== today)
  let minScore = 0
  if (pastDays.length) {
    const pastScores = pastDays.flatMap(([, ds]) => ds.map(s => s.score || 0)).sort((a, b) => b - a)
    // Median score of past days — stories below this aren't "top" material
    minScore = pastScores[Math.floor(pastScores.length / 2)] || 0
  }

  const allowed = new Set()
  for (const [, dayStories] of byDay) {
    const sorted = [...dayStories].sort((a, b) => (b.score || 0) - (a.score || 0))
    let n
    if (filter === 'top10') n = 10
    else if (filter === 'top20') n = 20
    else if (filter === 'top50') n = Math.ceil(sorted.length / 2)
    else n = sorted.length
    for (let i = 0; i < Math.min(n, sorted.length); i++) {
      // Only apply quality floor to top10/top20 — top50 is already lenient
      if (filter === 'top50' || (sorted[i].score || 0) >= minScore) {
        allowed.add(sorted[i].id)
      }
    }
  }
  return allowed
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
        ${v ? '' : '<span class="unread-dot"></span>'}
        <span class="home-points">${s.score || 0}</span>
        <span class="home-comments">${s.descendants || 0}</span>
      </a>
      <div>
        <div class="story-title">
          ${storyTag(s.title)}<a href="${url}" data-id="${s.id}">${esc(cleanTitle(s.title))}</a>
        </div>
        <div class="story-meta">
          ${s.by ? `<a href="#user/${s.by}" class="story-user" style="color: ${getUserColor(s.by, [])}">${esc(s.by)}</a>` : ''}${dom ? ` <span class="story-domain">(${dom})</span>` : ''}
          ·&nbsp;${timeAgo(s.time)}
          ·&nbsp;<a href="#item/${s.id}">${s.descendants || 0}&nbsp;comments</a>
        </div>
      </div>
    </li>`
}

function getVisibleStories(stories, filter) {
  const chrono = [...stories].sort((a, b) => b.time - a.time)
  const allowed = computeFilteredIds(stories, filter)
  if (!allowed) return chrono
  return chrono.filter(s => allowed.has(s.id))
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

// --- Home loading with cache ---

async function loadHome(filter) {
  const app = document.getElementById('app')
  homeFilter = filter
  renderNav(filter)

  const cached = getCachedStories()
  if (cached && cached.length) {
    homeStories = cached
    homeLoaded = true
    app.innerHTML = renderHomeFeed(homeStories, filter)
    setupHomeScroll()
    fetchStories().then(stories => {
      homeStories = stories
      setCachedStories(stories)
    }).catch(() => {})
    return
  }

  app.innerHTML = '<div class="loading">Loading stories…</div>'

  try {
    const stories = await fetchStories()
    homeStories = stories
    homeLoaded = true
    setCachedStories(stories)
    app.innerHTML = renderHomeFeed(homeStories, filter)
    setupHomeScroll()
  } catch (e) {
    app.innerHTML = `<div class="error">Failed to load: ${esc(e.message)}</div>`
  }
}

// --- Collapsed comment tracking (sessionStorage, per story) ---

let currentItemId = null
const COLLAPSED_PREFIX = 'hn-collapsed-'

function getCollapsed() {
  if (!currentItemId) return new Set()
  try {
    return new Set(JSON.parse(sessionStorage.getItem(COLLAPSED_PREFIX + currentItemId) || '[]'))
  } catch { return new Set() }
}

function saveCollapsed(ids) {
  if (!currentItemId) return
  if (ids.size === 0) sessionStorage.removeItem(COLLAPSED_PREFIX + currentItemId)
  else sessionStorage.setItem(COLLAPSED_PREFIX + currentItemId, JSON.stringify([...ids]))
}

function toggleCollapsed(commentId) {
  const collapsed = getCollapsed()
  if (collapsed.has(commentId)) collapsed.delete(commentId)
  else collapsed.add(commentId)
  saveCollapsed(collapsed)
}

// --- Item view ---

function renderComments(comments, ancestors = [], depth = 0) {
  if (!comments || !comments.length) return ''
  const collapsed = getCollapsed()
  return comments.map(c => {
    const color = getUserColor(c.user, ancestors)
    const prefix = getUserPrefix(c.user)
    const nextAncestors = [...ancestors, c.user]
    const isCollapsed = c.id && collapsed.has(String(c.id))
    const hasReplies = c.comments && c.comments.length > 0
    return `
    <div class="comment${c.dead ? ' dead' : ''}${isCollapsed ? ' collapsed' : ''}" data-comment-id="${c.id || ''}">
      <div class="comment-bar"><span class="collapse-icon">${isCollapsed ? '+' : '−'}</span></div>
      <div class="comment-content">
        <div class="comment-meta">
          ${prefix}<a href="#user/${c.user}" class="comment-user" data-user="${esc(c.user || '')}" style="color: ${color}">${esc(c.user || '[deleted]')}</a>
          <a href="#item/${c.id}" class="comment-time">${c.time_ago || ''}</a>
          <span class="collapse-target"></span>
        </div>
        <div class="comment-body">
          <div class="comment-text">${c.content || ''}</div>
          ${depth >= 5 && hasReplies
            ? `<a href="#item/${c.id}" class="continue-thread">continue thread →</a>`
            : renderComments(c.comments, nextAncestors, depth + 1)}
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
        · <button class="fav-btn" data-id="${item.id}">${isFavorite(item.id) ? 'unsave' : 'save'}</button>
        ${navigator.share ? `· <button class="share-btn" data-share-url="https://news.ycombinator.com/item?id=${item.id}" data-share-title="${esc(item.title || '')}">share</button>` : ''}
      </div>
    </div>
    ${item.content ? `<div class="item-text">${item.content}</div>` : ''}
    <div class="comments-container">${renderComments(item.comments)}</div>
  `
}

function formatDate(epoch) {
  return new Date(epoch * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function renderUser(user) {
  const created = user.created ? formatDate(user.created) : ''
  const submissions = user.submitted ? user.submitted.length : 0
  return `
    <div class="item-header">
      <h1>${esc(user.id)}</h1>
      <div class="item-meta">
        ${user.karma ?? 0} karma · joined ${created}
        · ${submissions} submissions
        · <a href="https://news.ycombinator.com/user?id=${esc(user.id)}">hn</a>
      </div>
    </div>
    ${user.about ? `<div class="item-text">${user.about}</div>` : ''}
  `
}

// --- Event delegation ---

function collapseComment(comment) {
  const wasCollapsed = comment.classList.contains('collapsed')
  comment.classList.toggle('collapsed')
  const icon = comment.querySelector(':scope > .comment-bar .collapse-icon')
  if (icon) icon.textContent = comment.classList.contains('collapsed') ? '+' : '−'
  const cid = comment.dataset.commentId
  if (cid) toggleCollapsed(cid)
  // When collapsing, scroll to the collapsed comment if its top is off-screen
  if (!wasCollapsed) {
    requestAnimationFrame(() => {
      const navHeight = document.querySelector('nav')?.offsetHeight || 0
      const commentTop = comment.getBoundingClientRect().top
      if (commentTop < navHeight) {
        const target = comment.getBoundingClientRect().top + window.scrollY - navHeight
        const start = window.scrollY
        const dist = target - start
        const duration = 150
        const t0 = performance.now()
        const step = (now) => {
          const p = Math.min((now - t0) / duration, 1)
          const ease = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2
          window.scrollTo(0, start + dist * ease)
          if (p < 1) requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }
    })
  }
}

document.addEventListener('click', (e) => {
  const bar = e.target.closest('.comment-bar')
  if (bar) {
    collapseComment(bar.closest('.comment'))
    return
  }

  // Invisible click target to the right of username/timestamp collapses
  if (e.target.closest('.collapse-target')) {
    collapseComment(e.target.closest('.comment'))
    return
  }

  const shareBtn = e.target.closest('.share-btn')
  if (shareBtn) {
    e.preventDefault()
    navigator.share({
      title: shareBtn.dataset.shareTitle,
      url: shareBtn.dataset.shareUrl,
    }).catch(() => {})
    return
  }

  const favBtn = e.target.closest('.fav-btn')
  if (favBtn) {
    e.preventDefault()
    toggleFavorite(favBtn.dataset.id).then(added => {
      favBtn.textContent = added ? 'unsave' : 'save'
    })
    return
  }

  // Active filter pill — re-clicking force-refreshes
  const pill = e.target.closest('.filter-pill.active')
  if (pill) {
    e.preventDefault()
    const r = getRoute()
    if (r.view === 'favorites') {
      loadFavorites()
    } else {
      savedScrollY = 0
      homeHTML = ''
      homeLoaded = false
      localStorage.removeItem(CACHE_KEY)
      loadHome(homeFilter)
    }
    return
  }

  const link = e.target.closest('a[data-id]')
  if (link) {
    markVisited(link.dataset.id)
    const story = link.closest('.story')
    if (story) story.classList.add('visited')
    const stats = story?.querySelector('.home-stats')
    if (stats) stats.classList.add('visited')
  }
})

// ESC to go back from item/user view
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const r = getRoute()
    if (r.view !== 'home') history.back()
  }
})

// --- Favorites view ---

async function loadFavorites() {
  const app = document.getElementById('app')
  const ids = [...favorites]
  if (!ids.length) {
    app.innerHTML = '<div class="loading">No saved stories yet.</div>'
    return
  }
  app.innerHTML = '<div class="loading">Loading saved stories…</div>'
  const results = await Promise.allSettled(
    ids.map(id => fetchJSON(`${API}/item/${id}`))
  )
  const items = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => normalizeStory(r.value))
    .sort((a, b) => b.time - a.time)

  let html = '<ol class="stories home-stories">'
  for (const s of items) html += renderHomeStory(s, items)
  html += '</ol>'
  app.innerHTML = html
}

// --- Router ---

let lastHomeFilter = null
let homeHTML = '' // cached DOM string for instant back-navigation

async function route() {
  const app = document.getElementById('app')
  const r = getRoute()

  if (homeObserver) { homeObserver.disconnect(); homeObserver = null }

  if (r.view === 'home') {
    document.title = 'Hacker News'
    // Restore cached home HTML and scroll position if available
    if (homeLoaded && homeHTML) {
      renderNav(r.filter)
      if (r.filter !== lastHomeFilter) {
        lastHomeFilter = r.filter
        homeFilter = r.filter
        app.innerHTML = renderHomeFeed(homeStories, r.filter)
        homeHTML = app.innerHTML
        setupHomeScroll()
      } else {
        app.innerHTML = homeHTML
        // Sync visited state for stories viewed since cache was saved
        for (const el of app.querySelectorAll('.home-story[data-id]')) {
          if (isVisited(el.dataset.id) && !el.classList.contains('visited')) {
            el.classList.add('visited')
            const stats = el.querySelector('.home-stats')
            if (stats) stats.classList.add('visited')
            const dot = el.querySelector('.unread-dot')
            if (dot) dot.remove()
          }
        }
        homeHTML = app.innerHTML
        setupHomeScroll()
        requestAnimationFrame(() => window.scrollTo(0, savedScrollY))
      }
    } else {
      lastHomeFilter = r.filter
      await loadHome(r.filter)
      homeHTML = app.innerHTML
    }
  } else if (r.view === 'item') {
    savedScrollY = window.scrollY
    homeHTML = app.innerHTML
    renderNav(homeFilter)
    app.innerHTML = '<div class="loading">Loading…</div>'
    try {
      const item = await fetchJSON(`${API}/item/${r.id}`)
      markVisited(r.id)
      currentItemId = r.id
      document.title = item.title || 'Hacker News'
      app.innerHTML = renderItem(item)
      window.scrollTo(0, 0)
      const usernames = collectUsernames(item.comments)
      if (usernames.size) {
        fetchNewAccounts(usernames).then(na => markNewAccounts(na, item))
      }
    } catch (e) {
      app.innerHTML = `<div class="error">Failed to load item: ${esc(e.message)}</div>`
    }
  } else if (r.view === 'favorites') {
    savedScrollY = window.scrollY
    homeHTML = app.innerHTML
    document.title = 'Saved — Hacker News'
    renderNav('favorites')
    await loadFavorites()
    window.scrollTo(0, 0)
  } else if (r.view === 'user') {
    savedScrollY = window.scrollY
    homeHTML = app.innerHTML
    renderNav(homeFilter)
    app.innerHTML = '<div class="loading">Loading…</div>'
    try {
      const user = await fetchJSON(`${HN_API}/user/${r.id}.json`)
      app.innerHTML = renderUser(user)
      window.scrollTo(0, 0)
    } catch (e) {
      app.innerHTML = `<div class="error">Failed to load user: ${esc(e.message)}</div>`
    }
  }
}

window.addEventListener('hashchange', route)

// Sync with KV on startup
syncVisited().then(() => syncFavorites()).then(() => {
  // Re-render if on home to reflect synced visited state
  const r = getRoute()
  if (r.view === 'home' && homeLoaded) {
    homeHTML = ''
    route()
  }
})

route()
