# Metamorfoseos 5 — Vultr Deployment Guide

Deploy to a Vultr Cloud Compute VM with Docker Compose. Host nginx terminates TLS for **https://metamorfoseos5.site** and proxies the Angular app and the Django API on the same host.

**Related files:**

| Path | Purpose |
|------|---------|
| `docker-compose.prod.yml` | Production containers. Postgres stays private. Frontend and API bind to localhost. |
| `docker/nginx/metamorfoseos5.site.http.conf` | Host nginx — HTTP bootstrap |
| `docker/nginx/metamorfoseos5.site.conf` | Host nginx — HTTPS |
| `docker/nginx/README.md` | Nginx install details |
| `env/metamorfoseos5.site/` | Production `.env` template |
| `deploy-production.sh` | Pull, build, and restart |

The dev `docker-compose.yml` is not used on the server. It runs `runserver` and `ng serve`.

---

## 1. Server

Ubuntu 24.04, 1 GB RAM, SSH key login. Amsterdam or Frankfurt.

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl git ufw nginx certbot python3-certbot-nginx

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy

if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

The 2 GB swap file is what lets `npm run build` finish on a 1 GB VM.

## 2. DNS

At the registrar, point these A records at the Vultr IPv4 address:

| Record | Host |
|--------|------|
| A | `metamorfoseos5.site` |
| A | `www.metamorfoseos5.site` |

The nameservers must be the registrar's live DNS, not a suspension or parking pair.

## 3. Clone and configure

```bash
su - deploy
git clone git@github.com:mekios/Condominium-Administration.git mtmf5
cd mtmf5
cp env/metamorfoseos5.site/docker.env.example .env
openssl rand -base64 48
openssl rand -base64 32
```

Put the first value in `DJANGO_SECRET_KEY` and the second in `POSTGRES_PASSWORD`.

Production Docker publishes:

| Service | Host port |
|---------|-----------|
| Frontend | `127.0.0.1:3000` |
| Backend | `127.0.0.1:8000` |

Postgres is only on the Docker network.

## 4. Build and start

```bash
./deploy-production.sh
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser
```

The script builds the frontend image, then the backend image, then starts the stack. Later updates are the same command: it pulls `main` and rebuilds.

## 5. Nginx and SSL

Confirm Docker is answering, then install the HTTP site, issue the certificate, and switch to the HTTPS config:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/admin/login/

sudo cp docker/nginx/metamorfoseos5.site.http.conf /etc/nginx/sites-available/metamorfoseos5.site
sudo ln -sf /etc/nginx/sites-available/metamorfoseos5.site /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d metamorfoseos5.site -d www.metamorfoseos5.site

sudo cp docker/nginx/metamorfoseos5.site.conf /etc/nginx/sites-available/metamorfoseos5.site
sudo nginx -t && sudo systemctl reload nginx
```

Public URLs:

| URL | Served by |
|-----|-----------|
| `https://metamorfoseos5.site/` | Angular |
| `https://metamorfoseos5.site/api/` | Django |
| `https://metamorfoseos5.site/admin/` | Django admin |

## 6. Email

Invites and password reset use SMTP. Fill `EMAIL_HOST`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, and `DEFAULT_FROM_EMAIL` in `.env`, then run `./deploy-production.sh` again. Vultr blocks outbound port 25, so use port 587. Add the provider's SPF and DKIM records for `metamorfoseos5.site`.

## 7. Updates

On the server, as `deploy`:

```bash
cd ~/mtmf5
./deploy-production.sh
```
