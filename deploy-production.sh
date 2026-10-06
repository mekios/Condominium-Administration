#!/bin/bash
set -euo pipefail

if [ -f "$(dirname "$0")/docker-compose.prod.yml" ]; then
  cd "$(dirname "$0")"
elif [ -d "$HOME/mtmf5" ]; then
  cd "$HOME/mtmf5"
elif [ -d /home/deploy/mtmf5 ]; then
  cd /home/deploy/mtmf5
elif [ -d /opt/mtmf5 ]; then
  cd /opt/mtmf5
else
  echo "ERROR: cannot find the project directory"
  exit 1
fi

COMPOSE="docker compose -f docker-compose.prod.yml"

if [ ! -f .env ]; then
  echo "ERROR: missing .env — cp env/metamorfoseos5.site/docker.env.example .env"
  exit 1
fi

git pull origin main

# 1 GB VM: build one image at a time so npm and pip do not run together.
echo "Building frontend..."
$COMPOSE build frontend
echo "Building backend..."
$COMPOSE build backend
$COMPOSE up -d --remove-orphans --no-build

if ! curl -sf -o /dev/null --connect-timeout 5 http://127.0.0.1:3000/; then
  echo "ERROR: frontend not responding on http://127.0.0.1:3000/"
  echo "  Check: docker compose -f docker-compose.prod.yml ps && ss -tlnp | grep 3000"
  exit 1
fi

admin_code="$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 http://127.0.0.1:8000/admin/login/ || true)"
if [ "$admin_code" != "200" ]; then
  echo "ERROR: backend /admin/login/ returned ${admin_code:-none} on http://127.0.0.1:8000/"
  exit 1
fi

if ! $COMPOSE exec -T frontend sh -c "grep -rq '/api/' /usr/share/nginx/html"; then
  echo "ERROR: frontend bundle has no /api/ calls"
  exit 1
fi

echo "OK: frontend on 127.0.0.1:3000, backend on 127.0.0.1:8000"
