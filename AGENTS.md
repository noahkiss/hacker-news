# HN Reader

Minimal Hacker News reader — Catppuccin Mocha dark theme, zero dependencies beyond Vite.

## Architecture

Three files: `index.html`, `src/main.js`, `src/style.css`. No framework, no build deps, no backend.

- **Data**: hackerwebapp API (stories + comments) + HN Firebase API (user data, story IDs)
- **Routing**: hash-based (`#`, `#item/{id}`, `#user/{id}`)
- **State**: localStorage (visited stories, story cache), sessionStorage (collapsed comments)
- **DOM**: plain innerHTML, no VDOM

## Features

- **Home feed**: chronological timeline, filter pills (top 10/20/50%/all) per day
- **Smart filtering**: minimum quality threshold computed from completed days' median scores — prevents low-quality stories from appearing in "top" filters during early morning hours
- **Engagement tiers**: points colored by percentile (peach hot, yellow warm, grey mid/cool)
- **Visited tracking**: dimmed stats + title, localStorage set capped at 2000
- **Thread view**: nested comments with collapsible grey sidebar bars
- **User colors**: 12 Catppuccin pastels, hash-assigned, ancestor-avoidance in threads
- **Admin/newbie badges**: red `[A]` for dang/tomhow, green `[N]` for <2 week accounts
- **Infinite scroll**: IntersectionObserver, 30-story chunks
- **Story cache**: 20 min TTL, background refresh

## Mobile

- Breakpoint at 600px
- Collapse bar hover effects disabled on mobile (prevents sticky thick bars)
- Deep comment nesting flattens at depth 7 (bars hidden) to prevent horizontal overflow
- `overflow-x: hidden` on body, main, comments-container
- `overflow-wrap: break-word` on comment/item text

## Deployment

- **Repo**: github.com/noahkiss/hacker-news
- **CF Pages**: https://hacker-news-eo5.pages.dev/
- **CI**: `.github/workflows/deploy.yml` — push to main auto-deploys
- **Local dev**: `nohup vite` at `http://100.111.111.10:2726`

## Icons

HN text on Catppuccin blue (`#89b4fa`) background with dark text (`#1e1e2e`). Generated from SVG via ImageMagick. Sizes: 512, 192, 180 (apple-touch), 32, 16, ico.

Web app manifest at `public/manifest.json` — standalone display, dark theme.
