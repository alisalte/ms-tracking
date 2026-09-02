# FleetVision — deploy to a Linux server (Docker Compose)

**Status:** Implemented (GitHub Actions CI + GHCR + SSH CD).  
Kubernetes / ArgoCD remains the long-term target (`docs/runbooks/ci-cd-pipeline.md`); this runbook is what actually ships the stack today.

The dashboard is published on **port 8080**. Device GPRS uses **5023** (Meitrack) and live video dialback uses **6182**. Everything else stays on the Docker network (or `127.0.0.1`).

---

## 1. What CI/CD does

| Workflow | When | What |
|---|---|---|
| **CI** (`.github/workflows/ci.yml`) | PR + push to `main` | Lint, typecheck, build, unit tests |
| **CI images** | Push to `main` (after verify) | Build every app image and push to `ghcr.io/<owner>/<repo>/<service>:<sha>` and `:main` |
| **CD** (`.github/workflows/cd.yml`) | Manual, or auto after CI if `ENABLE_CD=true` | SSH to the server, pull those images, `docker compose up` |

Image names match compose services (`identity-service`, `web-dashboard`, `map-engine`, …).

---

## 2. GitHub settings (once)

### Actions permissions

Settings → Actions → General → **Workflow permissions** → **Read and write**. Without this, the image job cannot push to GHCR.

### Packages

GHCR packages are created on the first successful `main` image job. They stay private if the repo is private. CD logs into GHCR with `GITHUB_TOKEN` (same repository is enough). Manual `docker pull` on the server needs a PAT with `read:packages`.

If the GitHub repo is private, the server clone also needs a **deploy key** (read-only) or HTTPS PAT so `git fetch` in CD works.

### Secrets (Settings → Secrets and variables → Actions)

| Secret | Purpose |
|---|---|
| `DEPLOY_HOST` | Server IP or hostname |
| `DEPLOY_USER` | SSH user (must be in the `docker` group) |
| `DEPLOY_SSH_KEY` | **Private** key whose public half is in `~/.ssh/authorized_keys` on the server |
| `DEPLOY_PATH` | Absolute path of the git clone, default `/opt/fleetvision/repo` |

Optional GitHub **variable** (not a secret):

| Variable | Purpose |
|---|---|
| `ENABLE_CD` | Set to `true` to auto-deploy after a green CI on `main`. Leave unset for manual-only. |

Optional: create a GitHub **Environment** named `production` and require a reviewer so CD waits for approval.

---

## 3. Server bootstrap (once)

Ubuntu 22.04+ / Debian 12, amd64, Docker Engine 24+ and Compose v2.24+ (`docker compose version`).

```bash
# Docker (official)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # then log out/in

# App layout
sudo mkdir -p /opt/fleetvision
sudo chown "$USER:$USER" /opt/fleetvision
git clone git@github.com:<owner>/<repo>.git /opt/fleetvision/repo

# Secrets — never commit this file
cp /opt/fleetvision/repo/infra/docker/.env.production.example /opt/fleetvision/.env
chmod 600 /opt/fleetvision/.env
# Edit JWT_SECRET, DB passwords, PUBLIC_ORIGIN, SEED_ADMIN_*, IMAGE_REGISTRY
```

`IMAGE_REGISTRY` must be **lowercase**:

```text
ghcr.io/<github-owner>/<github-repo>
```

`PUBLIC_ORIGIN` is the URL browsers use, no trailing slash, for example:

```text
PUBLIC_ORIGIN=http://203.0.113.10:8080
PUBLIC_ORIGIN=https://fleet.example.com
```

Open firewall: `8080/tcp` (UI), `5023/tcp` (trackers), `6182/tcp` (MDVR dialback). Put TLS in front (Caddy/nginx) if you have a domain; then set `PUBLIC_ORIGIN=https://…` and proxy to `127.0.0.1:8080`.

First deploy can be local on the server (no CD yet):

```bash
cd /opt/fleetvision/repo
echo "$GHCR_PAT" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
export IMAGE_REGISTRY=ghcr.io/<owner>/<repo>
export IMAGE_TAG=main
./tools/deploy-remote.sh
```

Or build on the server without GHCR (slower, no CI):

```bash
cd /opt/fleetvision/repo
docker compose --project-name fleetvision \
  -f infra/docker/docker-compose.yml \
  --env-file /opt/fleetvision/.env \
  up -d --build
```

---

## 4. Day-to-day

1. Merge to `main` → CI verify → images pushed to GHCR.
2. **Actions → CD → Run workflow** (or wait for auto-deploy).
3. Health: `curl -fsS http://SERVER:8080/` and `docker compose --project-name fleetvision ps`.

Rollback: run CD with `image_tag` set to a previous git SHA (that SHA must exist on GHCR).

```bash
# on the server
IMAGE_TAG=<old-sha> IMAGE_REGISTRY=ghcr.io/<owner>/<repo> ./tools/deploy-remote.sh
```

Logs: `pnpm stack:logs` from a clone, or `docker compose --project-name fleetvision logs -f --tail=100`.

---

## 5. First login

Seed credentials come from `/opt/fleetvision/.env` (`SEED_TENANT_NAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`). Change the admin password immediately.

Drivers (`/api/v1/fleet/…`) need the **fleet-service** container — it is part of compose and of the image matrix.

---

## 6. TLS (recommended)

Terminate HTTPS on the host (Caddy example):

```caddy
fleet.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

Set `WEB_PORT=8080` in `.env` and `PUBLIC_ORIGIN=https://fleet.example.com`. Device ports **5023** and **6182** stay TCP-as-is (trackers do not speak HTTPS).
