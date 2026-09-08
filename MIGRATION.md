# Moving PaperPulse off AWS

**Now:** ~$15–25/month · **After:** **$0/month**

You are moving one program, the backend API, from an AWS server onto your own Nitro box. Nothing
else moves. The website stays on Vercel, the login and database stay on Supabase, the knowledge
graph stays on Neo4j Aura. All three are free.

**No app code gets rewritten.** You don't need to remember how this project works.

---

## The idea in one paragraph

Right now Amazon runs one computer for you 24/7 (App Runner) and charges for it even when nobody
visits, because App Runner bills for reserved memory around the clock. Your Nitro box is already on
24/7 with 23 GB of spare memory. So you move that one job onto it. Unlike GrabPic, PaperPulse
stores nothing on Amazon: no S3 bucket, no SQS queue, no database. The only things in your AWS
account are the server itself and the container registry that feeds it, and both get deleted at the
end. That's why this one lands at exactly zero instead of a dollar.

---

## Order of operations: new server first

This runbook deploys to Nitro **before** turning AWS off, which is the opposite of the GrabPic
migration. You get no downtime and a working rollback you can compare against, at the cost of
roughly $1 of overlap. The GrabPic order (pause first, accept downtime) is still fine if you'd
rather stop the charge immediately; just do Step 6 first and ignore the deadline below.

> ## ⚠️ The one hard deadline
>
> **Do not let App Runner and Coolify both be running at 00:00 UTC.**
>
> The nightly pipeline checks "does this paper already exist?" and then inserts. Those two steps
> are not atomic, so two schedulers firing at the same instant both see "no" and both write. You
> get duplicate papers, duplicate feed rows, and a doubled OpenAI and Cohere bill for that night.
>
> The rule is simple: once the Coolify app is live, **pause App Runner before the next midnight
> UTC** (Step 6). If you can't finish in one sitting, stop *either* one before midnight. Breaking
> the overlap on either side is enough. Before Coolify is deployed there is no race at all, so
> Steps 1 and 2 are safe to leave sitting.

---

## Why this one is easier than GrabPic

| | GrabPic | PaperPulse |
|---|---|---|
| Apps to deploy | 3 | **1** |
| AWS data services still needed | S3 + SQS | **none** |
| IAM user and access keys | required | **not needed** |
| Cloudflare tunnel edit | required | **already done** |
| Code fixes to build | 2 files | **none, build verified** |
| AWS bill after | ~$1 | **$0** |

The `*.shahirahmed.com` wildcard you added for GrabPic in its Step 4 already routes anything at
that domain into Coolify. PaperPulse inherits it, so this migration touches no server config at
all: one DNS record, one Coolify app, one Vercel variable.

---

## What it costs at each stage

| | Per month |
|---|---|
| Now | ~$15–25 |
| During the overlap (a day or two) | ~$15–25, prorated |
| After Step 6 (App Runner paused) | **~$0.10** |
| After Step 7 (everything deleted) | **$0** |

The ~$0.10 is ECR storing the old container image, and it goes away at Step 7. Vercel, Supabase,
Neo4j Aura and Cloudflare Tunnel are all free at your size, and Nitro is already powered on.

> These numbers are estimated from the architecture, not read off your account. App Runner bills
> reserved memory continuously plus CPU only while handling requests, which is where the range
> comes from. Open **Billing → Bills** while you're in the console and note the real total.

---

## What I checked before writing this

Built and ran the actual image on Nitro, so none of the below is assumed:

| | |
|---|---|
| `backend/Dockerfile` builds clean | yes, 26s, no code fixes needed |
| Image size | 1.21 GB |
| Container boots and serves | `GET /` → `200 {"status":"PaperPulse API is running smoothly!"}` |
| Memory at idle | 187 MB (Nitro has 23 GB free) |
| Nightly scheduler starts | yes, `Background scheduler started` in the logs |
| Container timezone | UTC, identical to App Runner, so midnight stays midnight |
| Neo4j unreachable at boot | warns and continues, does not crash |

Two things that will bite if you don't know them, both found during that test:

- **The image has no `curl` and no `wget`.** Coolify's default health check shells out to one of
  them inside the container, so it would fail and flag the app unhealthy even though it's serving
  fine. Handled in Step 3.
- **Coolify defaults every new app to port 3000.** This one listens on **8000**, hardcoded in the
  Dockerfile's `CMD`. Also handled in Step 3.

---

## Step 1: Copy the credentials out of App Runner

**Why:** There is no `.env` file anywhere on your machine. I checked. The App Runner console is the
only place several of these values exist in one list, and you need all of them in Step 3.

**Do this before touching anything else.** Nothing is paused or deleted in this step.

**First: set the region.** Check the region selector at the top right against wherever
`paper-pulse-api` actually lives. If the console is showing the wrong region your service will look
like it doesn't exist.

**App Runner console** → your service → **Configuration** → **Environment variables**. Copy all of:

```
OPENAI_API_KEY
COHERE_API_KEY
SUPABASE_URL
SUPABASE_KEY
NEO4J_URI
NEO4J_USER
NEO4J_PASSWORD
CORS_ORIGIN
ADMIN_API_KEY
SEMANTIC_SCHOLAR_API_KEY     (optional, may not be set)
NCBI_API_KEY                 (optional, may not be set)
OPENALEX_MAILTO              (optional, may not be set)
```

Also copy the service's **Default domain** (the `*.awsapprunner.com` URL) and paste it somewhere
safe. That's your rollback address in Step 4, and it's easy to lose track of once the service is
paused.

Most of these are re-issuable from their own dashboards if lost, with **one exception**:
**Neo4j Aura shows the password only once, at instance creation.** If you lose it you have to reset
it from the Aura console, which is survivable but annoying. Get that one right.

While you're in the console, click **Billing → Bills** and note the real monthly total.

---

## Step 2: Give the API a web address

**Why:** Vercel needs a way to call your home server. Cloudflare Tunnel does this without opening
any ports on your router or exposing your home IP.

The tunnel config already sends everything at `*.shahirahmed.com` to Coolify, so there is nothing
to edit on Nitro. You only need the DNS record.

**Cloudflare dashboard → DNS → Add record:**

| Field | Value |
|---|---|
| Type | `CNAME` |
| Name | `paperpulse-api` |
| Target | `e7ccba18-5d3a-4417-9045-ff41b4906292.cfargotunnel.com` |
| Proxy status | **Proxied** (orange cloud on) |

> **Keep subdomains one level deep.** Cloudflare's free SSL covers `shahirahmed.com` and
> `*.shahirahmed.com` only. A name like `api.paperpulse.shahirahmed.com` sits two levels down, gets
> no certificate, and would need Advanced Certificate Manager at $10/month to fix.
> `paperpulse-api.shahirahmed.com` works, exactly like `grabpic-api` does.

**You'll know it worked:** `https://paperpulse-api.shahirahmed.com` returns a Coolify 404 page
rather than a DNS error. A 404 at this stage is correct, since nothing is deployed there yet.

---

## Step 3: Deploy the backend in Coolify

**Why:** This is the actual move.

Coolify → **New Resource** → **Application** → **Public Repository** →
`https://github.com/Shahir-47/paper-pulse` → Build Pack **Dockerfile**.

### Settings, field by field

| Field | Value | Coolify's default |
|---|---|---|
| Base Directory | `/backend` | `/` |
| Dockerfile Location | `/Dockerfile` | `/Dockerfile` |
| Ports Exposes | `8000` | **`3000`, must change** |
| Domains | `http://paperpulse-api.shahirahmed.com` | **an `sslip.io` name, must change** |
| Health check | **disabled** | enabled |

**Dockerfile Location is relative to Base Directory, not to the repo root.** Coolify joins the
two, so with Base Directory `/backend`, entering `/backend/Dockerfile` resolves to
`backend/backend/Dockerfile` and the build dies with
`failed to build: resolve : lstat .../backend/backend: no such file or directory`. Enter just
`/Dockerfile`. (GrabPic's runbook lists `/api/Dockerfile` for its API, but the running app is
configured as `/Dockerfile`. The doc recorded the first attempt, not the fix.)

**The port is the one that silently breaks everything.** The Dockerfile ends in
`uvicorn --port 8000` and reads no `PORT` variable, so leaving Coolify's default 3000 means the
proxy forwards to a port nothing is listening on and every request 502s.

**Type the domain as `http://`, not `https://`.** Cloudflare adds the padlock. Typing `https://`
makes Coolify chase its own certificate, which fails through a tunnel.

**Turn the health check off.** The image is `python:3.11-slim`, which ships neither `curl` nor
`wget`, so Coolify's default check cannot run and will report the app unhealthy while it is in fact
serving traffic. Your GrabPic apps already run with checks disabled. If you'd rather keep one, the
command has to use Python instead:

```
python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/')"
```

Don't add a host port mapping. Coolify reaches the container over its own network, the same way
`grabpic-api` works. Publishing 8000 on the host would collide with Coolify's own dashboard.

### Environment variables

Paste the values from Step 1. There are **no AWS variables**, because the backend never talks to
AWS.

```
OPENAI_API_KEY=                  ← from Step 1
COHERE_API_KEY=                  ← from Step 1

SUPABASE_URL=                    ← from Step 1
SUPABASE_KEY=                    ← service role key, from Step 1

NEO4J_URI=                       ← from Step 1
NEO4J_USER=                      ← from Step 1
NEO4J_PASSWORD=                  ← from Step 1

CORS_ORIGIN=                     ← your Vercel URL, e.g. https://paper-pulse.vercel.app

ADMIN_API_KEY=                   ← from Step 1

SEMANTIC_SCHOLAR_API_KEY=        ← optional, higher rate limits
NCBI_API_KEY=                    ← optional, higher rate limits
OPENALEX_MAILTO=                 ← optional, polite pool
```

**`CORS_ORIGIN` takes exactly one origin.** `main.py` does `allow_origins=[cors_origin]`, a
one-element list, so there's no way to allow both the Vercel production URL and a preview URL
without a code change. Use the production URL. This is unchanged from App Runner, not something
the move introduced.

No trailing slash on `CORS_ORIGIN`. Browsers match the origin string exactly and a stray `/` fails
every preflight.

**Optional:** set `TZ=America/New_York` (or wherever you are) if you want the nightly pipeline to
run at *your* midnight. Right now it runs at midnight UTC because both App Runner and the container
default to UTC. Setting it is a Coolify variable, not a code change, and it changes when your feed
refreshes. **Leave it unset until after Step 6**, since changing the schedule mid-migration makes
the midnight deadline above harder to reason about.

**You'll know it worked:** green in Coolify, and `https://paperpulse-api.shahirahmed.com` returns
`{"status":"PaperPulse API is running smoothly!"}`. Check the logs for
`Background scheduler started. Nightly pipeline set for midnight.`

At this point both servers are live and the midnight deadline is now running.

---

## Step 4: Point the website at the new server

**Why:** Vercel is still calling the old Amazon address.

Vercel dashboard → your project → **Settings** → **Environment Variables**. Change one:

```
NEXT_PUBLIC_API_URL = https://paperpulse-api.shahirahmed.com
```

`https://` here, because that's the public address. No trailing slash, no `/api` on the end. The
code builds URLs like `${NEXT_PUBLIC_API_URL}/feed/${user.id}`, so a trailing slash produces
`//feed/...` and 404s.

Then **Redeploy**. `NEXT_PUBLIC_*` values are baked in at build time, so changing the variable
alone does nothing until you rebuild.

---

## Step 5: Check it actually works

Do this before pausing AWS, while you still have something to compare against.

- [ ] Log in with Google or GitHub
- [ ] The feed loads with papers
- [ ] Open a paper, save it, and confirm it shows on the Saved page
- [ ] **Ask AI**: ask a question and watch the answer stream in token by token. This is the one
      worth testing carefully, since it's the only part whose behavior could change through a
      tunnel. Stage labels like "Searching your paper library..." should appear immediately.
- [ ] Upload a PDF or image in Ask AI and confirm it's read
- [ ] Open the **Knowledge Graph**, click a node, expand its connections
- [ ] Select a few papers and run a **Quick Review**, then a **Deep Analysis**
- [ ] Trigger the pipeline by hand and watch the Coolify logs:

```bash
curl -X POST https://paperpulse-api.shahirahmed.com/pipeline/run \
  -H "X-Admin-Key: <your ADMIN_API_KEY>"
```

Then `curl https://paperpulse-api.shahirahmed.com/pipeline/status -H "X-Admin-Key: ..."` until it
reports not running. This is the single most important check, because the nightly job is the thing
that would fail silently at midnight rather than loudly in front of you.

---

## Step 5b: Stand up Neo4j on Nitro

**Why:** The Aura instance was already deleted (see the notes below). Rather than create another
free Aura that will pause in 3 days and delete itself in 30, Neo4j now runs as a container on Nitro
alongside the API. It's free, has no expiry timer, and needs no code change: the driver reads
`NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` from the environment exactly as before.

Deployed with no published host ports, so it is reachable only from the `coolify` Docker network:

```bash
docker volume create paperpulse-neo4j-data
docker volume create paperpulse-neo4j-logs
docker run -d --name paperpulse-neo4j --network coolify --restart unless-stopped \
  -e NEO4J_AUTH="neo4j/<password>" \
  -e NEO4J_server_memory_heap_initial__size=1G \
  -e NEO4J_server_memory_heap_max__size=2G \
  -e NEO4J_server_memory_pagecache_size=1G \
  -v paperpulse-neo4j-data:/data -v paperpulse-neo4j-logs:/logs \
  neo4j:5.26-community
```

Version 5.26 Community (LTS) matches what Aura was running. Verified from inside the API container:
connectivity OK, and all six statements in `init_schema()` (four constraints, two fulltext indexes)
run clean. The code uses no APOC, no GDS and no vector index, so Community edition is enough.

Then set these in Coolify and redeploy:

```
NEO4J_URI=bolt://paperpulse-neo4j:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=                  ← saved at ~/paperpulse-neo4j-password.txt on Nitro
```

**`bolt://`, not `neo4j+s://`.** The Aura URI used TLS because it crossed the internet. This one
never leaves the Docker network, so there is no certificate to validate and `neo4j+s://` fails.

**You'll know it worked:** the startup log says `Schema initialized` instead of
`Failed to DNS resolve address`.

### Rebuilding the graph

Nothing to restore by hand. `pipeline_service.py` passes *every* `arxiv_id` in Supabase to
`run_graph_pipeline`, so the next nightly run reconstructs the whole graph from the papers you still
have. At the time of migration that was 1,459 papers, each costing one `o4-mini` entity-extraction
call, so let the midnight run do it rather than triggering a manual run on top of it and paying
twice. Check the OpenAI usage dashboard afterwards.

---

## Step 6: Pause App Runner (before the next 00:00 UTC)

**Why:** This is where the money goes, and it's also what ends the double-pipeline race.

**App Runner console** → your service → **Actions** → **Pause**.

Pause is the only thing that stops the charge; making the instance smaller doesn't help.

> **Pause, don't delete.** AWS stopped accepting new App Runner customers on April 30, 2026.
> Existing services keep running, but if you delete yours you probably can't create another.
> Pausing is fully reversible. Deleting is a one-way door. That's why Step 7 waits a week.

**You'll know it worked:** the site keeps working, because Vercel is pointed at Nitro now. Nothing
should visibly change. Your AWS bill stops climbing.

---

## Step 7: Delete the old AWS stuff (wait a week first)

Once it's been working for a week, **and you've seen at least one successful midnight run**, delete
both. Nothing here is still in use, and unlike GrabPic there's no bucket or queue to preserve.

- Delete the App Runner service
- Delete the `paper-pulse-api` ECR repository
- Delete `.github/workflows/deploy-backend.yml`, since it pushes to a registry that no longer
  exists and will fail on every push to `backend/**`. Coolify redeploys from GitHub on its own.
  This is the only file in the repo the migration ends up touching.
- Delete the GitHub Actions secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_REGION`,
  and deactivate that IAM user's access key in AWS. Leaving live keys in a repo that no longer
  needs them is the one genuine security loose end here.
- Set a **billing alarm at $1** so nothing surprises you later

**One last thing:** open Uptime Kuma (already running on Nitro) and add a check on
`https://paperpulse-api.shahirahmed.com/` every 5 minutes. It tells you if the API goes down, *and*
it keeps your free Supabase project awake. Supabase pauses after 7 days without traffic and Neo4j
Aura Free pauses after 3 days, which would silently break the app right when a recruiter clicks
your link.

---

## Things specific to PaperPulse that could bite

None of these are blockers, and apart from the midnight race none are new to the move. They're the
places where this app differs from GrabPic and where a problem would be hard to diagnose later.

- **Cloudflare's free plan drops a proxied connection after 100 seconds of silence.** All three SSE
  endpoints send a `stage` or `step` event before doing any slow work, so the stream opens
  instantly and token streaming keeps it alive. The one place with a real gap is **Deep Analysis**
  (`/graph/agent-synthesize`), which makes non-streaming reasoning-model calls between `step`
  events. If a single one of those ever runs past 100 seconds, the browser sees the connection
  drop. App Runner had a 120-second request timeout, so this was nearly the same risk before, just
  slightly looser. If it shows up, it looks like Deep Analysis dying partway with no error in the
  Coolify logs.
- **The nightly job runs inside the API process.** `BackgroundScheduler` is started in the FastAPI
  lifespan, so redeploying or restarting the app between runs is harmless, but a restart *during*
  the midnight run kills it partway with no retry. Redeploy in the morning, not at midnight.
  This actually gets safer on Coolify: App Runner could run several instances and fire the pipeline
  more than once, while one Coolify container can only fire it once.
- **`/pipeline/status` is in-memory.** It resets to `{"running": false}` on every restart, so it
  reports nothing about a run that was interrupted. Trust the logs over the endpoint.
- **Neo4j no longer has a deletion timer.** This used to be the biggest risk here: Aura Free
  deletes paused instances after 30 days, and it had already happened once. Since Step 5b the graph
  runs in a container on Nitro with a named volume, so it neither pauses nor expires. The data is
  also reconstructible from Supabase, which makes it the least precious thing in the stack.
- **The nightly run is the memory spike, not the idle load.** Idle is 187 MB, but the pipeline
  parses PDFs with PyMuPDF across four sources at once. Nitro has 23 GB free and Immich is the only
  other heavy tenant, so there's plenty of headroom. Worth a glance at `docker stats` after the
  first real midnight run.

---

## Notes from the actual migration

- **The README's env var table is wrong about Neo4j.** It documents `NEO4J_USERNAME`, but
  `neo4j_service.py:31` reads `NEO4J_USER`. The App Runner console had the correct name, so
  pasting from there worked. Anyone setting this up from the README alone would silently fall back
  to the default user `neo4j` and fail to authenticate.
- **The Neo4j Aura instance was already gone.** `2368fcf4.databases.neo4j.io` had no DNS record
  from anywhere, while `api.openai.com` resolved fine from inside the same container. Aura Free
  deletes instances after 30 days paused and drops the DNS record with them. This predates the
  migration: DNS is global, so App Runner had been failing identically. Graph features were already
  down in production.
- **Dockerfile Location is relative to Base Directory.** First deploy failed instantly with
  `lstat /artifacts/<id>/backend/backend: no such file or directory`. Base Directory `/backend`
  plus Dockerfile Location `/backend/Dockerfile` concatenates to `backend/backend/Dockerfile`.
  Setting it to `/Dockerfile` fixed it. Confirmed against the three GrabPic apps, all of which
  store `/Dockerfile` in Coolify's database regardless of what their runbook says.

---

## If something goes wrong

Nothing on AWS is deleted until Step 7, and App Runner isn't even paused until Step 6, so you can
always go back:

1. Un-pause App Runner if you've already paused it
2. Put the old `*.awsapprunner.com` address back in `NEXT_PUBLIC_API_URL` on Vercel and redeploy

Takes about five minutes. This is why Step 1 tells you to write the old URL down.

---

## Later, if you feel like it

**The frontend could move too, but shouldn't.** Vercel's free tier costs nothing, builds Next.js
faster than Nitro will, and serves it from a CDN. Moving it would add build load to your box and
save exactly $0. Leave it.

**Neo4j Aura already bit, and has been dealt with** in Step 5b. Nothing left to reconsider there.
Your stack now has no service with a deletion timer on it except Supabase's 7-day pause, which the
Uptime Kuma check covers.
