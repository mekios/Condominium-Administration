# metamorfoseos5.site production environment

Template for deploying to **https://metamorfoseos5.site**.

**Full walkthrough:** [`docs/VULTR_DEPLOYMENT_GUIDE.md`](../../docs/VULTR_DEPLOYMENT_GUIDE.md)  
**Host Nginx configs:** [`docker/nginx/README.md`](../../docker/nginx/README.md)

## 1. Generate secrets

```bash
openssl rand -base64 48    # DJANGO_SECRET_KEY
openssl rand -base64 32    # POSTGRES_PASSWORD
```

## 2. Project root `.env`

```bash
cp env/metamorfoseos5.site/docker.env.example .env
nano .env
```

Fill `DJANGO_SECRET_KEY` and `POSTGRES_PASSWORD`. Do not commit `.env`.

## 3. Start

```bash
./deploy-production.sh
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser
```

## Checklist

- [ ] `DJANGO_SECRET_KEY` and `POSTGRES_PASSWORD` set in root `.env`
- [ ] DNS A records for `@` and `www` point at the Vultr IP
- [ ] Host nginx proxies `/` to port 3000 and `/api/`, `/admin`, `/static/` to port 8000
- [ ] SMTP filled in before sending invites or password resets
