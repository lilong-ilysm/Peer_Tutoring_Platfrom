# AWS deployment readiness

**Question asked:** is this application suitable for deployment with **AWS Amplify**?

**Answer: not as built, and not because of a configuration gap.** Amplify Hosting is a
frontend/SSR-framework host; this is a server-rendered Node application with its own HTTP server and
a SQLite file. Two independent blockers, both architectural. Below: the evidence, the three ways
forward with honest costs, my recommendation, and what I did prepare (a container image and full
production configuration) so an AWS deployment is one decision away.

> **Deployment status: AWS deployment readiness has been verified, but actual deployment could not be
> confirmed because AWS access was unavailable.** No AWS account, credentials or CLI exist in this
> environment. Nothing in this document claims a deployment happened.

---

## 1. Why Amplify Hosting cannot host this app as it stands

### Blocker 1 — Amplify Hosting compute expects a supported framework's build output

Amplify's managed SSR compute targets Next.js, and other JavaScript SSR frameworks are supported
through open-source **build adapters** that transform a framework's output into the directory
structure Amplify Hosting expects — Nuxt, Astro and SvelteKit are the documented examples
([AWS: deploying SSR applications with Amplify Hosting](https://docs.aws.amazon.com/amplify/latest/userguide/server-side-rendering-amplify.html),
[Amplify support for Next.js](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html)).
*(Content was rephrased for compliance with licensing restrictions.)*

This application deliberately has **no framework**: `src/web/app.js` exports a plain
`(req, res)` handler served by `node:http`. There is no build step and no adapter, so there is no
artefact for Amplify Hosting to deploy. Producing one would mean writing an Amplify deployment
manifest and compute bundle by hand — an unsupported path for a project of this size.

### Blocker 2 — the database

Even with an adapter, Amplify's compute is ephemeral and horizontally scaled. This app's entire state
is a SQLite file that it writes to on every registration, booking and message. Ephemeral,
multi-instance compute gives each instance its own disposable filesystem, so bookings would diverge
and disappear. This is the same constraint that rules out Vercel, and AWS's container guidance says
the equivalent for containers: data written inside a container is destroyed with it, and persistence
requires decoupled storage such as EFS or EBS
([ECS storage best practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/storage.html)).

**Conclusion:** "make it work on Amplify" is not a deployment task. It is either an architecture
change or a different AWS service.

## 2. The three honest options

| | What it is | Code change | Effort | Keeps the 249-check suite meaningful? |
|---|---|---|---|---|
| **A. Container on AWS with attached storage** *(recommended)* | Run the existing image on ECS Fargate with an **EFS** volume, or on a small **EC2/Lightsail** instance with an **EBS** volume | **None** | Hours | Yes — same code, same tests |
| **B. Keep the app, move the database** | Container on **App Runner** (no EFS support) + **RDS PostgreSQL** | Data layer becomes async: ~130 call sites across 10 services | 1–2 days incl. re-testing | Mostly — tests need async updates |
| **C. Amplify as mandated** | Rewrite the view layer as a Next.js app on Amplify Hosting + **Cognito** for auth + **RDS or DynamoDB** + Lambda/API routes | Effectively a rewrite: views, auth, sessions, data access | Weeks | No — auth, session and view tests are discarded |

Notes on each:

- **A** is the simplest architecture that satisfies the requirement, which is the brief's own
  instruction ("do not add AWS services unnecessarily"). One task, one volume, one file to back up.
- **B** is worth it only if you want a managed database with automated backups and read replicas. It
  also fixes the single-writer limit. The refactor is mechanical but wide, and I would not do it
  without re-running and updating the whole suite.
- **C** should be a deliberate product decision, not a hosting workaround. It throws away a tested
  authentication and authorisation implementation in exchange for Cognito, and a tested server-rendered
  view layer in exchange for React. If your requirement is literally "must be on Amplify", say so and
  I will scope it properly — but I will not pretend it is a small change.

**Amplify does have a legitimate role in one variant:** if the project ever grows a separate SPA
frontend, Amplify Hosting is a good home for *that*, with this app as the API behind it on App Runner
or ECS. Today there is no separate frontend to host — the server renders the HTML — so adding Amplify
would mean adding a service that does nothing.

## 3. What is prepared and verified for option A

Committed in the repository:

- **`Dockerfile`** — `node:24-alpine`, source only (no `npm install` because there are no
  dependencies), runs as the unprivileged `node` user, `HEALTHCHECK` on `/`, `DATABASE_FILE`
  defaulting to `/data/peerlearn.db` so the volume mount is the only storage decision.
- **`.dockerignore`** — keeps `.git`, `.env`, `data/`, `tmp/`, tests and docs out of the image.
- **`railway.json`** — an equivalent container host, already documented in the README.

Verified locally by running the app exactly as a production container would (`NODE_ENV=production`,
`HOST=0.0.0.0`, `PORT` injected, `DATABASE_FILE` on a fresh path):

| Check | Result |
|---|---|
| Boots and migrates an empty database | Pass |
| `GET /` returns 200 (what a load-balancer health check needs) | Pass |
| `Strict-Transport-Security` sent in production | Pass |
| Session and CSRF cookies gain `Secure` | Pass |
| Registration works end to end on a brand-new production database | Pass |
| Static assets cached (`public, max-age=86400`), pages `no-store` | Pass |
| Refuses to boot in production without `SESSION_SECRET` | Pass (by design) |
| A fresh clone of the pushed repo passes all 249 checks with no install step | Pass |

**Not verified:** `docker build`/`docker run` (no Docker daemon in this environment), ECS/EFS mounting,
ALB health checks, and anything requiring an AWS account. The Dockerfile is straightforward and
dependency-free, but I have not executed it.

### Sketch: ECS Fargate + EFS

1. Push the image to **ECR** (`docker build -t peerlearn . && docker push …`).
2. Create an **EFS** file system in the same VPC; one access point at `/peerlearn`, POSIX uid/gid
   `1000` (the `node` user).
3. Task definition: 0.25 vCPU / 0.5 GB is ample. Mount the EFS access point at **`/data`**.
   Environment: `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000`,
   `DATABASE_FILE=/data/peerlearn.db`, `APP_TIMEZONE`, `APP_NAME`, `CURRENCY_SYMBOL`.
   `SESSION_SECRET` from **Secrets Manager** or SSM Parameter Store — never in the task definition
   as plaintext.
4. Service: **desired count 1** (SQLite has a single writer; the in-process rate limiter is per
   instance). Behind an **ALB** with the health check on `/` expecting 200.
5. TLS at the ALB via **ACM**; the app sets HSTS itself in production.
6. If you put CloudFront in front, set `TRUST_PROXY=true` so client IPs used for rate limiting come
   from `X-Forwarded-For`.
7. Backups: EFS backup policy, or a scheduled task running
   `sqlite3 /data/peerlearn.db ".backup /data/backup-$(date +%F).db"`.

Even simpler, if a single small VM is acceptable: Lightsail or EC2 with an EBS volume mounted at
`/data`, `docker run` the image, TLS via a reverse proxy. Cheapest and fewest moving parts.

## 4. Requirements from the brief, answered directly

| Requirement | Status |
|---|---|
| Production build succeeds | **N/A in the usual sense — there is no build step.** The "build" is `git clone`; verified by cloning the pushed repo and running the full suite (249/249) with no install |
| Correct build command / output directory | Not applicable (no bundler). Container `CMD` is `node src/server.js`; `railway.json` sets the start command |
| Environment variables handled correctly | Yes — all configuration via env, validated at boot, `.env.example` committed with names only |
| API URLs configurable | Not applicable — the server renders its own HTML and all links are site-relative. No API base URL exists to misconfigure |
| No localhost URLs in production code | Verified: the only `127.0.0.1` references are the dev default in `config.js` (overridden by `HOST`) and the container health check, which is correct |
| No development-only configuration required | Verified — a fresh clone boots with defaults |
| Assets load after deployment | Served by the app itself from `src/public` with correct MIME types and cache headers; verified in production mode. Asset URLs are versioned (`?v=2`) |
| Client-side routing 404s | Not applicable — server-rendered, every route is a real server route. Direct navigation to any URL works by construction (verified for 20+ paths) |
| Backend compatible with the intended AWS architecture | **Not with Amplify Hosting** (section 1); yes with ECS/App Runner/EC2 |
| Database not local/XAMPP/localhost | The database is a file, which is fine on a volume and wrong on ephemeral compute — hence option A. No MySQL/XAMPP anywhere |
| Credentials not committed | Verified: 80 tracked files, no `.env`, no `data/`; `.env.test` holds throwaway test values only |
| Data persists between deployments | Only with an attached volume — spelled out above, and the failure mode is documented |
| Database security considered | Single file readable only by the app's user; no network surface at all (nothing to expose or brute-force). With option B this becomes RDS in a private subnet |
| Schema/setup documented | `src/db/migrations/001_init.sql` is commented; README documents setup, seeding and backups |
| Actual AWS deployment tested | **No — AWS access unavailable.** Stated as required |

## 5. Recommendation

Take **option A** and put the container on ECS Fargate with EFS (or a Lightsail/EC2 VM with EBS).
It satisfies the deployment requirement with zero code change, keeps the entire verified test suite
meaningful, and costs one volume.

If "AWS Amplify" is a hard, non-negotiable requirement of the assignment, tell me and I will plan
option C properly — including what it means for the parts of the system that are currently tested and
working (own authentication and sessions → Cognito; server-rendered views → React/Next.js;
SQLite → RDS or DynamoDB). That is a re-architecture with a real schedule, and it should be a decision
you make with the trade-offs in front of you, not something I slip in under the heading of
"deployment".
