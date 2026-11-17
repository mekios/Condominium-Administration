# Dockerization & Operational Setup

## 1. Target architecture (containers)
Development (`docker-compose.yml`):
- `postgres`: Django database
- `redis`: started, unused by Django
- `backend`: Django `runserver` on container port 8000, published as host `8001`
- `frontend`: `ng serve` on container port 4200, published as host `8081`

Production (`docker-compose.prod.yml`):
- `postgres`: private to the Compose network
- `backend`: gunicorn, bound to `127.0.0.1:8000`
- `frontend`: built Angular assets behind container nginx, bound to `127.0.0.1:3000`
- no Redis
- TLS is host nginx + Certbot, not a Compose service. See `docs/VULTR_DEPLOYMENT_GUIDE.md`

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

## 3. Compose files
`docker-compose.yml` is the dev stack. `docker-compose.prod.yml` is what the server runs. The skeleton below is historical and is not the production file.

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
- `EMAIL_HOST_USER` (Login on Brevo → SMTP & API → SMTP, often `…@smtp-brevo.com`) and `EMAIL_HOST_PASSWORD` (SMTP key `xsmtpsib-…`, not an API key)
- `DEFAULT_FROM_EMAIL` (must be a sender verified in Brevo)
- `EMAIL_BACKEND` (optional override; defaults to console when the Brevo login or SMTP key is empty, otherwise Django SMTP)
- `FRONTEND_LOGIN_URL` (link included in invite emails, e.g. `http://localhost:8081/login`)

User onboarding (Django admin):
1. Add user with username, email, role, and apartment links.
2. A temporary password is emailed automatically on create.
3. If delivery fails, use admin action **«Αποστολή πρόσκλησης (νέος προσωρινός κωδικός)»**.
4. On first login the user must set a strong password before accessing the app.

Redis is present in dev Compose only. Django has no `CACHES` setting and does not read `REDIS_URL`. Production Compose does not start Redis.

## 5. Frontend API base URL
Dev uses `frontend/src/app/core/api.constants.ts` (backend on port 8001).
Production builds replace it with `api.constants.prod.ts` (same-origin `/api`). See `frontend/angular.json` file replacements.

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

## 8. Caching and jobs
Invoice generation, PDF build, and email send run inside the request. There is no Celery worker and no Django cache. Redis in the dev Compose file can be ignored.

If a cache is added, key it by user scope plus apartment and month. See `docs/06-security-model.md`.

## 9. Operational decisions
- Invoice regeneration is synchronous.
- Admins can delete a payment. There is no payment edit API.
- Production TLS is host nginx + Certbot. Local Compose stays on HTTP.

