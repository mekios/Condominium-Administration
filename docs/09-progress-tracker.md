# Block-of-Flats Admin: Progress Tracker

## Project status snapshot
- Date: 2026-03-19
- Current phase: Sprint execution
- Active sprint: Sprint 4

## Sprint progress

| Sprint | Status | Progress | Notes |
|---|---|---:|---|
| Sprint 1 - Foundation + Auth + Apartment Scoping | Completed | 100% | Usable vertical slice delivered |
| Sprint 2 - Measurements + Expenses + First Invoices | Completed | 100% | Core models/endpoints and usable invoice generation delivered |
| Sprint 3 - Formula + Gas/Water split correctness | Completed | 100% | Allocation correctness, range-based expense linkage, and draft billing preview delivered |
| Sprint 4 - Payments + Receipts + Email | In progress | 65% | Payment records, invoice paid-state updates, receipt generation, and receipt email dispatch delivered |
| Sprint 5 - Voting + Monthly invoice emailing | Not started | 0% | Depends on auth/domain maturity |
| Sprint 6 - Hardening + Production readiness | Not started | 0% | Final stabilization |

## Sprint 1 completion details

### Delivered
- Dockerized scaffold:
  - `docker-compose.yml`
  - services: `postgres`, `redis`, `backend`, `frontend`
- Backend foundation:
  - Django project + DRF + SimpleJWT
  - custom user model with role and preferred language
  - core models for building/apartment scoping:
    - `Building`, `Apartment`, `ApartmentUser`, `DesignatedVoter`
  - API endpoints:
    - `POST /api/token/`
    - `POST /api/token/refresh/`
    - `GET /api/me/`
    - `GET /api/apartments/`
- Frontend foundation:
  - Angular standalone app scaffold
  - auth service + auth interceptor + route guard
  - login page (Greek)
  - protected dashboard page with apartment list
- Operations and setup:
  - backend/frontend Dockerfiles
  - `.env.example`
  - root `README.md`

### Verification summary
- Django checks: pass
- Angular production build: pass
- API smoke test: pass
  - token obtain returns `200`
  - `GET /api/me/` returns `200`
  - `GET /api/apartments/` returns scoped data
- Docker compose config validation: pass

### Demo credentials (dev seed)
- username: `superadmin`
- password: `admin12345`

## Sprint 2 completion details

### Delivered so far
- Backend Sprint 2 data models:
  - `HeatingMeasurementInput`
  - `HeatedWaterMeasurementInput`
  - `ExpenseItem`
  - `Invoice`
- Backend Sprint 2 APIs:
  - `GET/POST/PATCH /api/accounting/heating-inputs/`
  - `GET/POST/PATCH /api/accounting/heated-water-inputs/`
  - `GET/POST/PATCH /api/accounting/expenses/`
  - `GET /api/invoices/`
  - `POST /api/invoices/generate/`
- Invoice generation behavior:
  - month-based generation per apartment
  - ownership-permille split for common recurring expenses
  - invoice totals + outstanding balance persisted
- Frontend usable slice:
  - dashboard includes month selection
  - generate invoices action for admin roles
  - invoice list view for selected month

### Verification summary (Sprint 2 partial)
- Backend checks: pass
- Frontend build: pass
- API smoke tests: pass
  - create expense -> returns `201`
  - generate invoices -> returns `200`
  - list invoices for month -> returns expected per-apartment totals

## Sprint 3 progress details (current)

### Delivered so far
- Backend invoice allocation engine upgraded for Sprint 3:
  - gas bill split into radiator vs heated-water portions
  - radiator allocation uses the agreed formula components (`fi`, `ei`, `units_counted`)
  - heated-water energy allocation by apartment heated-water volume
  - water-consumption expense allocation by apartment heated-water volume
- Added validation feedback during generation:
  - validates `sum(fi*ei)` bounds (`0..1`) per building
  - gracefully handles months with missing measurement rows (zero allocation for missing apartments)
- Monetary rounding unified to 2 decimals via shared quantization helper in invoice generation flow.
- Automated backend tests added:
  - formula allocation correctness test
  - invalid `sum(fi*ei)` validation rejection test
- Frontend Sprint 3 usability slice added:
  - dedicated measurements screen with:
    - month list + expandable month detail
    - unified monthly entry table (heating + hot-water in one row)
    - previous/current readings and computed diff units
    - default month suggestion (next available month)
  - dedicated expenses and invoices screens in the shared admin shell
- Measurement data model/API refinements:
  - added `current_reading` fields for heating and heated-water inputs
  - added month workflow APIs:
    - `/accounting/heating-inputs/months/`
    - `/accounting/heating-inputs/month-detail/`
    - `/accounting/heating-inputs/entry-form/`
    - `/accounting/heating-inputs/monthly-upsert/`
- Runtime stability fixes:
  - switched frontend to Angular live-edit dev mode in Docker (`ng serve`)
  - enabled explicit zone-based change detection provider for predictable interpolation updates

### Verification summary (Sprint 3 partial)
- Backend checks: pass
- Backend tests: pass (`manage.py test flats`)
- Frontend production build: pass
- API smoke tests: pass
  - create heating/heated-water inputs -> returns `201`
  - create gas/water expenses -> returns `201`
  - generate invoices -> returns `200`
  - list invoices for month -> returns split component totals per apartment
  - monthly measurement workflow endpoints return expected month/detail/form payloads

## Current blockers
- No functional blockers for Sprint 4 implementation.

## Sprint 4 progress details (current)

### Delivered so far
- Backend payment lifecycle:
  - new entities: `PaymentRecord`, `InvoiceDocument`, `NotificationDispatch`
  - API endpoints:
    - `GET/POST /api/accounting/payments/`
    - `POST /api/invoices/{id}/mark-paid/`
    - `POST /api/invoices/{id}/send-receipt/`
- Financial behavior:
  - payment registration updates `paid_total`, `outstanding_balance`, `status`
  - full or partial payment supported
  - overpayment rejected
- Receipt automation:
  - receipt PDF generated and persisted per payment
  - receipt email dispatch logged with statuses (`queued/sent/failed/skipped`)
  - duplicate resend protection unless `force=true`
- Frontend usable slice:
  - new `Payments` page in app shell navigation
  - admin can register payments per invoice
  - all users can view month-filtered payment history for scoped apartments
- Automated tests added:
  - mark-paid flow creates payment + receipt + sent notification
  - resend endpoint blocks duplicate receipt without force

### Verification summary (Sprint 4 partial)
- Backend tests: pass (`manage.py test flats.tests`)
- Frontend production build: pass (`npm run build`)
- Migration generated for new Sprint 4 entities

## Next immediate actions
1. Add invoice PDF template persistence and monthly invoice email dispatch (Sprint 5 dependency).
2. Expand payment UI with per-invoice payment timeline drawer.
3. Add retry tooling for failed notification dispatches.

