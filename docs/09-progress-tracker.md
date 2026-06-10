# Block-of-Flats Admin: Progress Tracker

## Project status snapshot
- Date: 2026-03-19
- Current phase: Sprint execution
- Active sprint: Sprint 5

## Sprint progress

| Sprint | Status | Progress | Notes |
|---|---|---:|---|
| Sprint 1 - Foundation + Auth + Apartment Scoping | Completed | 100% | Usable vertical slice delivered |
| Sprint 2 - Measurements + Expenses + First Invoices | Completed | 100% | Core models/endpoints and usable invoice generation delivered |
| Sprint 3 - Formula + Gas/Water split correctness | Completed | 100% | Allocation correctness, range-based expense linkage, and draft billing preview delivered |
| Sprint 4 - Payments + Receipts + Email | In progress | 90% | Payment flow complete, receipt/invoice PDF generation upgraded, monthly invoice email dispatch added, and invoice generation responses/tests hardened |
| Sprint 5 - Voting + Monthly invoice emailing | In progress | 70% | Voting backend plus admin management UI (create/edit/status transitions) delivered |
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
- Monthly invoice distribution (new):
  - `POST /api/invoices/send-monthly-invoices/` for admin/superadmin
  - sends invoice PDF attachments per apartment for selected month
  - persists invoice PDF in `InvoiceDocument` (`document_type=invoice`)
  - tracks each send in `NotificationDispatch` (`notification_type=invoice_monthly`)
  - duplicate protection (`skipped`) unless `force=true`
- Failed notification retry tooling (new):
  - `POST /api/invoices/retry-failed-notifications/`
  - retries failed dispatches for monthly invoices and paid receipts
  - supports filtering by `month`, `notification_type`, and `dispatch_id`
  - returns retry summary (`retried/sent/failed/skipped`)
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
- New backend test coverage:
  - monthly invoice bulk email dispatch success + duplicate skip behavior
  - allocation edge-cases validated for multi-building/month isolation and cent-rounding remainder distribution
  - invoice generation response payload now returns clearer summary metadata (`month`, `created`, `updated`, `warnings`)

## Next immediate actions
1. Add end-to-end smoke checks for monthly invoice send/retry actions from UI.
2. Add API tests for analysis-share fallback behavior when preview data is unavailable.
3. Optional: expense delete button in UI (backend already admin-guarded).

## Sprint 5 progress details (current)

### Delivered so far
- Voting backend domain added:
  - `VoteSession` model (building-scoped sessions with status and window)
  - `Vote` model (one vote per apartment per session via DB unique constraint)
- Voting API endpoints added:
  - `GET/POST/PATCH/PUT/DELETE /api/voting/sessions/` (admin/superadmin writes)
  - `GET/POST /api/voting/sessions/{id}/votes/` (list votes and cast/update vote)
  - `GET /api/voting/sessions/{id}/results/` (post-close aggregate counts)
- Designated voter management endpoint added:
  - `PUT /api/apartments/{id}/designated-voter/` (superadmin only)
- Authorization and invariants enforced:
  - regular users only see sessions in their building scope
  - vote submission allowed only for active sessions and inside start/end window
  - vote submission requires apartment membership + designated voter assignment
  - repeated submission updates existing vote for the same session/apartment
- Frontend voting UI added:
  - new route/page: `/app/voting`
  - new detail page: `/app/voting/:id`
  - sidebar navigation entry: `Ψηφοφορίες`
  - sessions list-first flow (active + inactive lists) for faster selection
  - vote/manage actions moved to detail page for cleaner UX
  - vote submission form supports both default (`ναι/όχι/αποχή`) and custom per-session options
  - votes table refresh and results panel refresh
  - voting creation popup includes optional custom options list (comma-separated)
  - admin management controls for sessions:
    - create session form (building/type/title/description/window/status)
    - edit selected session details
    - status transitions (draft/active/closed) from dedicated action buttons

### Verification summary (Sprint 5 partial)
- Backend migrations: pass (`flats.0011_alter_notificationdispatch_notification_type_and_more`)
- New voting tests: pass
- Full backend test suite: pass (`manage.py test flats.tests`)
- Frontend build: pass (`npm run build`)

## Admin mode + destructive admin actions (delivered)

### Delivered
- Frontend administrator-only **Λειτουργία διαχειριστή** toggle (`AdminModeService`, sessionStorage-backed)
- Superadmin keeps always-on management UI; administrator write controls gated behind toggle
- Management actions in admin mode: measurements entry, invoice generation, expense edits, payment entry, voting session setup/status
- Destructive admin actions (admin mode / superadmin):
  - delete measurements by date (`DELETE /api/accounting/heating-inputs/by-date/`)
  - delete individual payments (`DELETE /api/accounting/payments/{id}/`)
  - recall invoices with cascade payment removal (`POST /api/invoices/{id}/recall/`)
- Backend hardening: admin-only `destroy` on measurement and expense viewsets
- Tests: `AdminDestructiveOperationsTests` (authorization, balance rollback, recall cascade)

### Verification summary
- New destructive-ops tests: pass (`manage.py test flats.tests.AdminDestructiveOperationsTests`)
- Frontend build: pass (`npm run build`)

