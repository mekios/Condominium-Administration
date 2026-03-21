# Block-of-Flats Admin - Sprint 1

Sprint 1 delivers:
- Dockerized project scaffold (`backend`, `frontend`, `postgres`, `redis`)
- Django backend with JWT auth
- Core apartment-scoped data model
- Angular login + guarded dashboard
- Apartment-scoped listing endpoint (`/api/apartments/`)

## Stack
- Backend: Django + DRF + SimpleJWT
- Frontend: Angular (standalone)
- Infra: Docker Compose, PostgreSQL, Redis

## Local run (without Docker)

### Backend
```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

### Frontend
```bash
cd frontend
npm install
npm start
```

Frontend default: `http://localhost:4200`  
Backend default: `http://localhost:8001` (run backend on this port for frontend compatibility)

## Docker run
```bash
docker compose up --build
```

Frontend: `http://localhost:8081`  
Backend: `http://localhost:8001`

## Seeded demo account
- username: `superadmin`
- password: `admin12345`

## Sprint 1 API endpoints
- `POST /api/token/` - obtain JWT access/refresh
- `POST /api/token/refresh/` - refresh token
- `GET /api/me/` - current user profile (auth required)
- `GET /api/apartments/` - scoped apartment list (auth required)
