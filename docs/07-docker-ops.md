# Dockerization & Operational Setup

## 1. Target architecture (containers)
Minimum services (local dev and production-like):
- `redis`: caching layer for Django cache
- `postgres`: persistent database for Django
- `backend`: Django + DRF API (gunicorn + migrations)
- `frontend`: Angular app
  - dev mode: `ng serve` with live edit/watch
  - production mode: static assets served via nginx

Optional (later):
- `nginx` reverse proxy for TLS termination and routing (if you want HTTPS locally)

## 2. Suggested repo layout
Proposed directories at repo root:
- `backend/`
  - Django project + apps
  - `Dockerfile`
- `frontend/`
  - Angular workspace/app
  - `Dockerfile`
- `docs/` (this documentation)
- `docker-compose.yml`

Also consider:
- `./.env.example` with required environment variables
- `./backend/entrypoint.sh` to run migrations + collectstatic

## 3. `docker-compose.yml` (reference)
Below is a reference skeleton for a “production-like” compose setup.

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: flatsadmin
      POSTGRES_USER: flatsadmin
      POSTGRES_PASSWORD: flatsadmin
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgres://flatsadmin:flatsadmin@postgres:5432/flatsadmin
      REDIS_URL: redis://redis:6379/0
      DJANGO_SECRET_KEY: change-me
      DJANGO_DEBUG: "0"
      ALLOWED_HOSTS: localhost,127.0.0.1
      CORS_ALLOWED_ORIGINS: http://localhost:4200,http://localhost
    depends_on:
      - postgres
      - redis
    ports:
      - "8000:8000"

  frontend:
    build: ./frontend
    depends_on:
      - backend
    ports:
      - "8080:80"

volumes:
  postgres_data:
```

Notes:
- Adjust ports for your workflow:
  - frontend at `8080` -> served from nginx
  - backend at `8000`
- In production you would typically not expose Postgres/Redis to the host.

## 4. Backend environment variables
Minimum set (suggested):
- `DJANGO_SECRET_KEY` (required)
- `DJANGO_DEBUG` (`0`/`1`)
- `DATABASE_URL` (or explicit `POSTGRES_*` vars)
- `REDIS_URL` (for Django cache)
- `ALLOWED_HOSTS` (comma-separated)
- `CORS_ALLOWED_ORIGINS` (for browser -> API)
- `CSRF_TRUSTED_ORIGINS` (if using session auth; if only JWT header auth, CSRF may be less relevant)
- `DEFAULT_LOCALE` (set to `el` for MVP Greek-first output)
- `SUPPORTED_LOCALES` (set to `el`; later `el,en`)

Email (user invites, password reset, and invoice/receipt dispatch) is sent through Brevo SMTP:
- `EMAIL_HOST` defaults to `smtp-relay.brevo.com`, `EMAIL_PORT` `587`, `EMAIL_USE_TLS` `1`
- `EMAIL_HOST_USER` (Brevo account email) and `EMAIL_HOST_PASSWORD` (Brevo SMTP key)
- `DEFAULT_FROM_EMAIL` (must be a sender verified in Brevo)
- `EMAIL_BACKEND` (optional override; defaults to console when the Brevo login or SMTP key is empty, otherwise Django SMTP)
- `FRONTEND_LOGIN_URL` (link included in invite emails, e.g. `http://localhost:8081/login`)

User onboarding (Django admin):
1. Add user with username, email, role, and apartment links.
2. A temporary password is emailed automatically on create.
3. If delivery fails, use admin action **«Αποστολή πρόσκλησης (νέος προσωρινός κωδικός)»**.
4. On first login the user must set a strong password before accessing the app.

Redis cache config (Django):
- Use `django-redis` with `CACHES["default"]` pointing at `REDIS_URL`.

## 5. Frontend environment variables
Angular typically needs:
- `environment.apiBaseUrl` (e.g., `http://localhost:8000`)

For containerized builds, prefer:
- build-time replacement or
- runtime config injection (TBD)

## 6. Local development workflow (commands)
Assuming you have Docker and Docker Compose v2 installed:

1. Start dependencies:
```bash
docker compose up -d postgres redis
```

2. Start the backend and frontend:
```bash
docker compose up --build -d backend frontend
```

3. Apply database migrations:
```bash
docker compose exec backend python manage.py migrate
```

4. (Optional) Create initial admin user:
```bash
docker compose exec backend python manage.py createsuperuser
```

5. Verify services (current dev mapping):
 - backend API: `http://localhost:8001`
 - frontend (Angular dev server): `http://localhost:8081`

## 7. Container build approach (suggested)
Backend `Dockerfile`:
- base python image
- install dependencies
- copy source
- run gunicorn
- optionally run migrations at startup via entrypoint

Frontend build modes:
- **Development (current):**
  - frontend service uses Node container + `ng serve --watch`
  - source folder is mounted as a volume for instant live edit
  - host port `8081` maps to container `4200`
- **Production-like:**
  - frontend Dockerfile builds Angular into `dist/`
  - nginx serves static files with SPA fallback routing

## 8. Cache invalidation strategy (operational notes)
When you later implement caching/invalidation:
- Key patterns:
  - `invoice_totals:{apartment_id}:{month}`
  - `stats_month:{apartment_id}:{month}`
  - `session_results:{session_id}`
- Invalidate:
  - on heating/heated-water input edits: affected apartment + month keys
  - on expense edits: all apartments for affected month (since allocations use ownership permille)
  - on payment insert: invoice balance keys for that invoice

Decide whether recalculation is synchronous (simpler, potentially slower) or via background tasks (e.g. Celery; optional, not in current scope).

## 9. Open operational decisions (TBD)
- Are you okay with “invoice regeneration is synchronous” (request waits) or do you want background jobs?
- Should payments be editable or append-only for audit safety?
- Do you want nginx reverse-proxy with TLS for local HTTPS?

