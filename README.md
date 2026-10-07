# shuf-flip

Vite + React + TypeScript front end with a Hono API over the fishDict
PostgreSQL dictionary (`db/dump.sql`).

## Getting started

```bash
npm install
npm run db:up      # start PostgreSQL + pgweb (Docker)
npm run dev        # Vite (5173) + Hono API (8787) together
```

- Web: http://localhost:5173
- API: http://localhost:8787/api/health
- pgweb (DB browser): http://localhost:8081

The Vite dev server proxies `/api/*` to the Hono server, so the front end
calls same-origin paths (`fetch('/api/books')`).

## Scripts

- `npm run dev` — start web + api
- `npm run dev:web` — Vite only
- `npm run dev:api` — Hono only (`tsx watch server/index.ts`)
- `npm run build` — type-check and build
- `npm run preview` — preview production build
- `npm run lint` — run oxlint

### Database

- `npm run db:up` / `npm run db:down` — start / stop the stack
- `npm run db:reset` — recreate the DB from `db/dump.sql` (drops the volume)
- `npm run db:psql` — psql shell
- `npm run db:web` — pgweb at http://localhost:8081
- `npm run db:dump` / `npm run db:restore` — dump / restore `db/dump.sql`
- `npm run db:logs` — follow DB logs

The schema and data come from `db/dump.sql`, which is loaded by the Postgres
container on first start (empty volume). It is the fishDict dictionary dump and
owns the `public` schema. `db/schema.sql` adds the app-owned tables
(accounts/sessions/progress) in the separate `app` schema, and is applied after
the dump on first start, or with `npm run db:schema` on an existing DB. Keeping
them apart means pgweb shows `public` (dictionary) and `app` (app state) as two
groups. The connection sets `search_path = app, public` (both in `db/schema.sql`
and the pool in `server/db.ts`), so unqualified queries resolve either way;
`npm run db:schema` also relocates tables from older databases that kept them in
`public`.

- `npm run db:schema` — (re)apply `db/schema.sql` to the running DB

## Accounts: users & guests

One `users` table holds both registered accounts and guests, distinguished by
`is_guest`. A guest created by "Just browsing" owns progress like any account
and can be upgraded in place by setting `username` + `pin_hash`, so every
foreign key pointing at its id survives.

| Table | Purpose |
|---|---|
| `users` | accounts; `is_guest` guests have no username/pin, real accounts have both |
| `sessions` | opaque bearer tokens (only the hash is stored), `ON DELETE CASCADE` from `users` |
| `login_attempts` | every login attempt, for brute-force throttling (a 4-digit PIN has 10k values) |

Rules enforced in the DB:

- `username` matches `^[a-z][a-z0-9]{2,19}$`, unique (partial index, guests' NULLs excluded)
- `users_identity`: guest ⇔ no username/pin; account ⇔ both set
- 4-digit PIN is stored only as a tagged hash (`pin_hash`), never in clear
- `updated_at` is kept fresh by a trigger

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | liveness |
| GET | `/api/languages` | language codes + word counts |
| GET | `/api/books` | wordbooks with live totals + progress |
| GET | `/api/books/custom` | `{book}` → the user's saved customization |
| PUT | `/api/books/custom` | `{book, exclude[], addon[]}` → save it |
| GET | `/api/deck?book=<id>` | words for a book (+ `limit`, `offset`, `shuffle=1`) |
| POST | `/api/auth/guest` | create (or resume) a guest session |
| POST | `/api/auth/register` | `{username, pin}` → account; upgrades a guest in place |
| POST | `/api/auth/login` | `{username, pin}` |
| POST | `/api/auth/logout` | end the session |
| GET | `/api/auth/me` | current user, `401` when signed out |
| POST | `/api/study/round` | `{book, advance?, roundSize?, mix?}` → deal one round |
| PUT | `/api/study/progress` | `{book, roundSeq, day?, exposed[], met{}}` → record |
| GET | `/api/progress` | `{day, days?}` → today's totals, a daily series, today's rounds, per-language burst |
| GET | `/api/progress/days` | `{from, to}` → per-day activity for the calendar |
| GET | `/api/progress/words` | `{day?}` → that day's revealed words (word, reveals, new/review) |
| GET | `/api/settings` | current user's study settings |
| PUT | `/api/settings` | partial update `{dailyGoal?, mix?, roundSize?}` |

The session token is an `httpOnly` cookie (`sf_session`); only its SHA-256 hash
is stored server-side. A 4-digit PIN is hashed with scrypt and throttled after
5 failures in 15 minutes.

Wordbook ids: `en-primary`, `en-junior`, `en-senior`, `en-cet4`, `en-cet6`,
`en-ox3`, `en-ox5`, `hsk-1`…`hsk-7`, `jlpt-1`…`jlpt-4`, `ko-1`…`ko-3`.

Each deck card carries `word`, `phonetic`, `senses`, `tags`, `sound`.

## Configuration

Copy `.env.example` to `.env` to override defaults:

- `DATABASE_URL` — default `postgres://shuf:shuf@localhost:5433/shuf`
- `PORT` — Hono port, default `8787`

## Progress

As you study, the Flip page reports two things per word:

- **exposed** — the word was brought to the centre of the deck. Counted at
  most **once per round**, so the number is "how many rounds you've seen it".
- **met** — its definition was revealed (flipped). The flip count is
  accumulated forever.

Both land in `user_word_stats` (`(user, lang, word)`), and are also bucketed
by **logical day** (local time, rolling over at **04:00**) in `user_word_daily`.
The client computes the day and batches updates (debounced), flushing on round
change / unmount / page hide. `/api/books` counts distinct words per book for
`learned` / `exposed`.

`GET /api/progress` reads `user_word_daily`:

- **learned** (the daily goal's numerator) = distinct words revealed that day;
  a word revealed n times still counts once
- **exposed** = distinct words brought to the centre; **reveals** = total flips
- **newWords** = revealed today and first ever revealed today
- **reviewWords** = revealed today but revealed on an earlier day
- **exposedOnly** = exposed today but never revealed today

So `newWords + reviewWords = learned` (the pie: new / review / exposed-only),
and on the first day `reviewWords` is always 0.

The goal itself is `user_settings.daily_goal`.

It also returns `rounds` — one entry per dealt round today with its
`exposed` (distinct words) and `reveals` (flips), from `user_rounds`. The day
view's bar chart is one bar per round.

And `languages` — per language, how the touched words split across
`exposed` (seen but never revealed) / `before` (first revealed earlier) /
`today` (first revealed today). This feeds the sunburst (Progress + Home).

`GET /api/progress/days?from&to` returns
`{ day, learned, exposed, reveals, new, review }` per day. The Progress
calendar colours each day by `learned` and can page through months, and the
month view's bar chart is one bar per day (`review` / `new`), with the headline
total being their sum.

## Wordbook customization

Only the wordbook being studied can be customized. A customization folds in
`addon` lists and drops `exclude` lists, and the **effective pool** is
`(base ∪ addons) − excludes`. It is saved in `user_book_custom` and applied
everywhere: `/api/books` (so `total` is the effective total, alongside
`baseTotal`), `/api/deck`, and study dealing. `learned` / `exposed` are counted
against the effective pool too, so the progress meters follow.

## Results

Results is a **day-scoped checkpoint**. When the day's distinct revealed words
(new or review, deduped) reach **5 / 20 / 50 / 200**, the study "next" action
(Enter or the arrow, plus double-right-click) opens Results instead of dealing
another round; Continue deals the next round. The highest celebrated milestone
is remembered per logical day (localStorage). The source for the day's numbers
is `GET /api/progress`; the word list comes from `GET /api/progress/words`.

## Routes

| Path | Page |
|---|---|
| `/` | Home |
| `/books` | Wordbooks |
| `/progress` | Progress |
| `/settings` | Settings |
| `/study/:book` | Study — deals rounds for that wordbook |
| `/results` | Results |
| `/login` | Login overlay |

The active wordbook is synced per account (`user_settings.active_book`, with a
localStorage fallback) and carried in the `/study/:book` URL. "Study this
book" on Wordbooks sets it without navigating; Home's "Start" opens Study for
it. The **last centred word** is synced per (user, book) in
`cascades.last_word` and restored on resume, so a session continues on any
device.

## Sampling

Study deals a round through **cascading windows**: each round is drawn from a
small active window, and the window only rotates every few rounds, so words
clump into short bursts instead of being uniformly scattered. Parameters:
`W = 4R` (so the in-window rate is always 25%), `g = 4`, `m = 3`, and
`n = 6 / 4 / 8` (default / faster new words / more review). `R` (round size)
is 8 or 16. The cursor is persisted per (user, book) in the
`cascades` table. The study route reads `roundSize` / `mix` from the user's
`user_settings` (body values override), so Settings drive dealing directly.
See [`docs/sampling.md`](docs/sampling.md) and
[`server/sampling.ts`](server/sampling.ts).

## Layout

```
server/            Hono API
  index.ts         routes + server bootstrap
  books.ts         wordbook defs, pools, card details
  sampling.ts      cascading-window dealing (W=4R, g=4, m=3, n=6/4/8)
  study.ts         POST /api/study/round
  settings.ts      per-user settings (GET/PUT /api/settings)
  auth.ts pin.ts   accounts + hashing
db/dump.sql        PostgreSQL dictionary schema + data (fishDict, schema public)
db/schema.sql      app tables in schema `app`: users, sessions, login_attempts, cascades, user_settings, user_word_stats, user_word_daily, user_round_words, user_rounds
docs/sampling.md   the dealing algorithm
docker-compose.yml Postgres (5433) + pgweb (8081)
src/               React app
```
