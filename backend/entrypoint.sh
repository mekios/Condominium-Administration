#!/bin/sh
set -eu

if [ "${RUN_DJANGO_STARTUP:-0}" = "1" ]; then
  python manage.py migrate --noinput
  python manage.py collectstatic --noinput
fi

exec "$@"
