# Host Nginx configs (production)

These files configure **Nginx on the Vultr/Ubuntu host**, not the frontend Docker container (`frontend/nginx.conf`).

## metamorfoseos5.site layout

| Public URL | Proxies to | Docker service |
|------------|------------|----------------|
| `https://metamorfoseos5.site/` | `127.0.0.1:3000` | frontend (nginx + Angular build) |
| `https://metamorfoseos5.site/api/` | `127.0.0.1:8000` | backend (Django) |
| `https://metamorfoseos5.site/admin/` | `127.0.0.1:8000` | Django admin |
| `https://metamorfoseos5.site/static/` | `127.0.0.1:8000` | Django static files (WhiteNoise) |

`www.metamorfoseos5.site` uses the same server block.

## Files

| File | Purpose |
|------|---------|
| `metamorfoseos5.site.http.conf` | HTTP-only bootstrap before SSL |
| `metamorfoseos5.site.conf` | Full HTTPS production config |

## Install (fresh server)

1. **DNS** — A records for `@` and `www` → server IP.

2. **HTTP first** (if no SSL yet):

   ```bash
   sudo cp docker/nginx/metamorfoseos5.site.http.conf /etc/nginx/sites-available/metamorfoseos5.site
   sudo ln -sf /etc/nginx/sites-available/metamorfoseos5.site /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t && sudo systemctl reload nginx
   ```

3. **SSL**:

   ```bash
   sudo certbot --nginx -d metamorfoseos5.site -d www.metamorfoseos5.site
   ```

4. **Switch to the HTTPS config** (Certbot edits the HTTP file in place; this copy is the one to keep):

   ```bash
   sudo cp docker/nginx/metamorfoseos5.site.conf /etc/nginx/sites-available/metamorfoseos5.site
   sudo nginx -t && sudo systemctl reload nginx
   ```

   Certificate path is `/etc/letsencrypt/live/metamorfoseos5.site/`.

## Verify

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/admin/login/
ss -tlnp | grep -E '3000|8000'
```

Frontend must be `127.0.0.1:3000` and the API `127.0.0.1:8000`. Neither port should listen on `0.0.0.0`.
