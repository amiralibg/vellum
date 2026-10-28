# Deploying Vellum with Dokploy

One image (`Dockerfile`) serves the dashboard, the API, the `/p/:slug` reader pages and the uploaded HTML sites.
`docker-compose.prod.yml` runs it next to Postgres. Dokploy builds it from GitHub and puts Traefik (with HTTPS) in front.

| Origin | Example | Serves |
| --- | --- | --- |
| `APP_URL` | `https://vellum.amiralibg.xyz` | Dashboard, API, `/p/:slug` |
| `USERCONTENT_URL` | `https://usercontent.vellum.amiralibg.xyz` | Uploaded HTML only, sandboxed, behind signed links |

Both hostnames point at the same container. The app tells them apart by host, so they must be different hostnames.

## 1. DNS

Add two A records pointing at the VPS: `vellum.amiralibg.xyz` and `usercontent.vellum.amiralibg.xyz`
(or one wildcard `*.vellum.amiralibg.xyz` plus `vellum.amiralibg.xyz`).

If Cloudflare proxies them (orange cloud), set `TRUST_PROXY=2` below, since there are then two proxies in
front of the app. Cloudflare also sends `CF-IPCountry`, which fills in the country on recent views.

## 2. Create the service

In Dokploy: **Project → Create Service → Compose**.

- Provider: GitHub, repository `amiralibg/vellum`, the branch to deploy
- Compose path: `./docker-compose.prod.yml`
- Compose type: Docker Compose

## 3. Environment tab

The container gets no `.env` file; everything comes from here. Generate each secret once and keep a copy:
changing `SIGNING_SECRET` signs every reader out of password-protected documents, and changing `ENCRYPTION_KEY`
makes the saved document passwords unreadable on the document page.

```sh
APP_URL=https://vellum.amiralibg.xyz
USERCONTENT_URL=https://usercontent.vellum.amiralibg.xyz
TRUST_PROXY=1

# openssl rand -hex 24 (hex, so it's safe inside the database URL)
POSTGRES_PASSWORD=

# Created on the first boot only. To change them later, see "Owner reset".
OWNER_EMAIL=you@amiralibg.xyz
OWNER_PASSWORD=
OWNER_NAME=Amirali

# openssl rand -base64 48 (each)
SIGNING_SECRET=
ENCRYPTION_KEY=

# Limits (these are the defaults)
MAX_UPLOAD_MB=20
MAX_UNZIPPED_MB=100
MAX_ZIP_FILES=1000
```

A missing required variable stops the deploy with a message naming it. A wrong value stops the app at boot, and the
app's log lists each problem, e.g. `SIGNING_SECRET: SIGNING_SECRET must be at least 32 characters`.

## 4. Domains tab

Add two domains, both on service `app`, container port `8000`, HTTPS on, certificate Let's Encrypt:

- `vellum.amiralibg.xyz`
- `usercontent.vellum.amiralibg.xyz`

## 5. Deploy

Press **Deploy**. The app's log should end with:

```
Vellum API on :8000 · app https://vellum.amiralibg.xyz · usercontent https://usercontent.vellum.amiralibg.xyz
```

Database migrations run on every boot before the app starts listening. Open `APP_URL` and sign in with
`OWNER_EMAIL` / `OWNER_PASSWORD`.

## What persists

| Volume | Holds |
| --- | --- |
| `vellum-postgres` | The database: documents, versions, settings, views |
| `vellum-data` | `DATA_DIR`: uploaded originals and unpacked HTML sites |

Back up both. On the VPS, `docker ps --format '{{.Names}}' | grep vellum` lists the containers and
`docker volume ls | grep vellum` the volumes. Their names start with the compose project's name in Dokploy (for
example `vellum-x1y2z3-postgres-1`). Don't confuse them with Dokploy's own `dokploy-postgres`. Then:

```sh
docker exec <postgres container> pg_dump -U vellum vellum > vellum-$(date +%F).sql
docker run --rm -v <data volume>:/data -v "$PWD":/out alpine tar czf /out/vellum-data-$(date +%F).tgz -C /data .
```

Postgres is also published on `127.0.0.1:5433` on the VPS only, for `psql` over SSH. It isn't reachable from outside.

## Owner reset

The owner account is created from the environment on the first boot only. To change the email or password later:

1. Change `OWNER_EMAIL` / `OWNER_PASSWORD` in the Environment tab and redeploy.
2. Open a terminal in the app container (in Dokploy, the service's terminal for `app`; or over SSH,
   `docker exec -it <app container> sh`, using the name from `docker ps`) and run:

```sh
node dist/owner-reset.js
```

It sets the owner's email and password from the environment and signs out every session.

## When something's wrong

- **502 from Traefik:** the app isn't up. Read the app container's log; an `Invalid environment` block lists what to fix.
- **"Unknown host":** the request's host matches neither `APP_URL` nor `USERCONTENT_URL`. Check both URLs, and
  that `TRUST_PROXY` counts the proxies in front (1 for Traefik, 2 with Cloudflare proxying too).
- **HTML documents show a blank frame:** the usercontent domain has no certificate yet, or its DNS record is missing.
- **Health:** the image checks `GET /health` every 30 seconds; `docker ps` shows `healthy` once it answers.
