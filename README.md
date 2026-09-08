# Discord Contest Notifier

A production-ready, serverless Discord competitive programming contest notification bot built with **TypeScript**, **Netlify Functions**, **Netlify Async Workloads**, **CLIST API v4**, and a **persistent database** with multi-server and timezone support.

---

## 🚀 Key Features

* **CLIST API Synchronization**: Automatically synchronizes contests from Codeforces, LeetCode, AtCoder, CodeChef, and other platforms.
* **Serverless Durable Scheduling**: Uses **Netlify Async Workloads** (`step.sleep()`) for durable, delayed contest-start notifications without persistent WebSocket connections, `setTimeout`, or long-running polling servers.
* **Rock-Solid Idempotency**: Atomic database claims prevent duplicate notifications even during async workload retries or concurrent invocations.
* **Rescheduling & Cancellation Handling**: Automatically detects when contest start times shift or contests are cancelled, dynamically updating notification schedules without duplicate alerts.
* **Daily & Weekly Digests**:
  * **Daily Digest**: Scheduled daily summary of contests occurring that day, sorted chronologically.
  * **Weekly Digest**: Scheduled weekly summary of upcoming contests grouped by day of the week.
* **Multi-Server & Multi-Timezone Architecture**: Allows multiple Discord servers to configure their own local timezone, channels, and platform subscriptions (e.g. Server A wants Codeforces and LeetCode in `Asia/Kolkata`, Server B wants AtCoder in `America/New_York`).
* **Hybrid Discord Delivery**: Supports both Discord Bot Token REST channel messages (`/channels/{id}/messages`) and Discord Webhooks.
* **Dual Database Support**:
  * **Production**: PostgreSQL via standard connection string (`DATABASE_URL`, supporting Neon, Supabase, RDS, etc.).
  * **Testing/Offline**: SQLite / in-memory database with zero external dependencies.

---

## 🏛️ Architecture

```text
               ┌───────────────────────┐
               │     CLIST API v4      │
               └──────────┬────────────┘
                          │ (Periodic sync: hourly / every 2h)
                          ▼
               ┌───────────────────────┐
               │ netlify/functions/    │
               │ sync-contests.ts      │
               └──────────┬────────────┘
                          │ (Upsert & Detect changes)
                          ▼
               ┌───────────────────────┐
               │  Persistent Database  │
               │ (PostgreSQL / SQLite) │
               └──────────┬────────────┘
                          │ (Dispatch start event)
                          ▼
               ┌───────────────────────┐
               │ Netlify Async Workload│
               │ (step.sleep to start) │
               └──────────┬────────────┘
                          │ (On wake: Reload, Validate,
                          │  Check Idempotency)
                          ▼
               ┌───────────────────────┐
               │ Discord HTTP REST API │
               │ (Channel msg/Webhook) │
               └───────────────────────┘
```

---

## 📁 Project Structure

```text
├── netlify/
│   └── functions/
│       ├── sync-contests.ts       # Scheduled function: syncs CLIST to DB & schedules workloads
│       ├── contest-workload.ts    # Netlify Async Workload: durable sleep & validated start alert
│       ├── daily-digest.ts        # Scheduled function: daily summary
│       ├── weekly-digest.ts       # Scheduled function: weekly summary
│       └── notify-manual.ts       # HTTP POST: test/trigger manual notification
│
├── src/
│   ├── clist/
│   │   ├── client.ts              # CLIST API client with 429 rate limit backoff
│   │   └── types.ts               # Raw and normalized contest types
│   │
│   ├── contests/
│   │   ├── service.ts             # Sync coordinator & change detection
│   │   ├── repository.ts          # Contests, notifications, & servers data access
│   │   └── types.ts               # Domain models & change results
│   │
│   ├── notifications/
│   │   ├── scheduler.ts           # Async Workload dispatcher & DB scheduler
│   │   ├── contest-start.ts       # Notification runner with atomic idempotency
│   │   └── types.ts               # Event payload contracts
│   │
│   ├── discord/
│   │   ├── client.ts              # Discord HTTP REST client & Webhook dispatcher
│   │   ├── formatter.ts           # Embed builder with platform colors & timezones
│   │   └── types.ts               # Discord payload types
│   │
│   ├── digests/
│   │   ├── daily.ts               # Daily digest logic & platform filtering
│   │   └── weekly.ts              # Weekly digest grouping logic
│   │
│   ├── database/
│   │   ├── schema.sql             # SQL DDL migrations
│   │   ├── adapter.ts             # DatabaseAdapter (Postgres & SQLite)
│   │   ├── connection.ts          # Connection pool manager
│   │   └── migrate.ts             # Migration runner
│   │
│   ├── utils/
│   │   ├── timezone.ts            # Server timezone conversion & day/week bounds
│   │   └── logger.ts              # Structured logger
│   │
│   └── config.ts                  # Environment configuration
│
├── tests/
│   ├── clist.test.ts              # CLIST client & rate-limiting tests
│   ├── database.test.ts           # Upsert, migrations, idempotency tests
│   ├── scheduler.test.ts          # Scheduling, rescheduling, cancellation tests
│   ├── discord.test.ts            # Embed formatting & Discord delivery tests
│   ├── digests.test.ts            # Daily and weekly digest tests
│   ├── sync.test.ts               # Periodic synchronization integration tests
│   └── edge-cases.test.ts         # Section 19 edge cases & concurrency tests
│
├── netlify.toml                   # Netlify build, schedule, & function configs
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` and configure your credentials:

```bash
cp .env.example .env
```

| Variable | Description | Example |
| :--- | :--- | :--- |
| `CLIST_USERNAME` | Your CLIST username | `john_doe` |
| `CLIST_API_KEY` | Your CLIST API key | `a1b2c3d4...` |
| `DATABASE_URL` | PostgreSQL connection string (or `sqlite:local.db`) | `postgresql://user:pass@host:5432/contests?sslmode=require` |
| `DISCORD_BOT_TOKEN` | Discord Bot Token | `OTkzN...` |
| `DISCORD_APPLICATION_ID` | Discord Application ID | `123456789...` |
| `DEFAULT_STARTED_CHANNEL_ID`| Fallback channel for contest started alerts | `111222333` |
| `DEFAULT_DAILY_CHANNEL_ID`  | Fallback channel for daily digests | `111222444` |
| `DEFAULT_WEEKLY_CHANNEL_ID` | Fallback channel for weekly digests | `111222555` |
| `DEFAULT_WEBHOOK_URL`       | Fallback Discord Webhook URL (optional) | `https://discord.com/api/webhooks/...` |
| `DEFAULT_TIMEZONE`          | Fallback server timezone | `UTC` (or `Asia/Kolkata`, `America/New_York`) |

---

## 🛠️ Setup & Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Database Migrations
```bash
npx ts-node src/database/migrate.ts
```

### 3. Run Tests
```bash
npm test
```

### 4. Build TypeScript Project
```bash
npm run build
```

---

## 🌐 Netlify Deployment

1. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Initial commit: Discord Contest Notifier"
   git push origin main
   ```
2. **Connect to Netlify**:
   * Create a new site from your GitHub repository in Netlify.
   * Netlify automatically reads `netlify.toml` for build command (`npm run build`) and functions directory (`netlify/functions`).
3. **Configure Environment Variables**:
   * In Netlify Site Settings → Environment variables, add `CLIST_USERNAME`, `CLIST_API_KEY`, `DATABASE_URL`, and `DISCORD_BOT_TOKEN`.
4. **Enable Netlify Async Workloads**:
   * Under your Netlify Team settings, ensure Async Workloads are enabled for durable delayed executions.
5. **Scheduled Functions**:
   * `sync-contests` runs every 2 hours: `0 */2 * * *`.
   * `daily-digest` runs daily at midnight: `0 0 * * *`.
   * `weekly-digest` runs Mondays at midnight: `0 0 * * 1`.
