# Διαχείριση πολυκατοικίας — Μεταμόρφωσεως 5

Greek-first admin app for one block of flats (Μεταμόρφωσεως 5, Χαλάνδρι). Residents see invoices, payments, and votes for apartments they are linked to. An administrator enters measurements, expenses, and payments. A superadmin invites users from Django admin and sets the designated voter.

## Stack
- Backend: Django + DRF + SimpleJWT
- Frontend: Angular (standalone), default UI language Greek
- Data: PostgreSQL
- Mail: Brevo SMTP (console backend when SMTP credentials are empty)
- Production: Docker Compose bound to localhost, host nginx + Certbot at https://metamorfoseos5.site

## Local run (without Docker)

### Backend
```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8001
```

### Frontend
```bash
cd frontend
npm install
npm start
```

Frontend: `http://localhost:4200`  
Backend: `http://localhost:8001`

## Docker run (development)
```bash
docker compose up --build
```

Frontend: `http://localhost:8081`  
Backend: `http://localhost:8001`

Development Compose includes Redis, but the Django app does not use it as a cache.

## Production
See `docs/VULTR_DEPLOYMENT_GUIDE.md` and `./deploy-production.sh`. Production Compose does not run Redis.

## Seeded demo account
- username: `superadmin`
- password: `admin12345`

## App routes
- `/login`, `/forgot-password`, `/reset-password`, `/set-password`
- `/app/dashboard`, `/app/invoices`, `/app/expenses`, `/app/measurements`, `/app/voting`, `/app/profile`
- `/app/payments` and `/app/analysis` exist; analysis is opened from the dashboard

## Docs
| Doc | Contents |
|---|---|
| `docs/01-requirements.md` | Roles and user stories |
| `docs/02-domain-model.md` | Models as implemented |
| `docs/03-accounting-rules.md` | Allocation, invoices, reserve |
| `docs/04-api-spec.md` | REST endpoints |
| `docs/05-ui-flows.md` | Screens and flows |
| `docs/06-security-model.md` | Authorization rules |
| `docs/07-docker-ops.md` | Local and production containers |
| `docs/08-sprint-plan.md` | Original sprint plan and delivery status |
| `docs/09-progress-tracker.md` | Current status |
| `docs/VULTR_DEPLOYMENT_GUIDE.md` | Production host setup |
