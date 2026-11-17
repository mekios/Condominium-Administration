# Block-of-Flats Admin: Progress Tracker

## Project status snapshot
- Date: 2026-11-17
- Branch: `main` (matches `origin/main`)
- Last product commit: 2026-11-03 — remaining building capital no longer counts billed expenses twice
- Site: https://metamorfoseos5.site
- Active work: Sprint 6 leftovers (hardening). Sprints 1–5 are delivered.

## Sprint progress

| Sprint | Status | Notes |
|---|---|---|
| Sprint 1 — Foundation + auth + apartment scoping | Completed | JWT, roles, apartment list, login, Docker scaffold |
| Sprint 2 — Measurements + expenses + invoices | Completed | Month invoices from expenses and readings |
| Sprint 3 — Heating formula + gas/water split | Completed | Boiler reading splits the gas bill; cent rounding with remainder |
| Sprint 4 — Payments + receipts + email | Completed | Payments, Greek PDFs, receipt and monthly invoice email, retry |
| Sprint 5 — Voting + monthly invoice email | Completed | Sessions, one final vote per apartment, custom options, bulk invoice email |
| Sprint 6 — Hardening + production | In progress | Production HTTPS, invites, password reset, and Greek UX are in. Cache, backups, and end-to-end tests are not |

## What is in the product

### People and access
- Roles on `User`: `superadmin`, `administrator`, `user`
- Apartment membership with `is_tenant` / `is_owner`
- One designated voter per apartment (superadmin, Django admin or `PUT /api/apartments/{id}/designated-voter/`)
- Email invite with a temporary password and forced first-login change (`must_change_password`)
- Forgot-password and profile password change
- Administrator write controls sit behind **Λειτουργία διαχειριστή** (`sessionStorage`). Superadmin management stays on. The API still checks role

There is no `AdministratorTerm`. Closing an election does not change anyone’s role. The superadmin sets `User.role`.

### Accounting
- Readings are stored by `measurement_date` for apartment heating, apartment hot water, and the building boiler (`BuildingMeasurementInput`)
- One gas bill (`gas_heating_bill`) is split with boiler energy versus apartment heating units, then the radiator share uses `fi` / `ei`
- Hot-water energy and the hot-water consumption bill (`water_hw_consumption_bill`) follow hot-water volume
- Common, non-recurring, owners-only, and fund-increase lines follow ownership permille
- `fund_increase` also adds to `Building.fund_balance`
- Invoices keep component totals, `owners_only_total`, and an optional `custom_adjustment`
- Dashboard remaining capital = reserve − unpaid invoice balances − expenses in months that are not yet issued or paid. Fund-increase rows are excluded from that expense subtraction
- Payments update `paid_total` / `outstanding_balance`. Admins can delete a payment. Recalling a month deletes that month’s invoices, payments, and stored PDFs
- A measurement date is locked once invoices exist for its calendar month

### Documents and mail
- Invoice and receipt PDFs are stored on `InvoiceDocument` and downloaded through authenticated endpoints
- Brevo SMTP sends invites, password reset, monthly invoices, and receipts. Empty SMTP credentials print mail to the console
- `NotificationDispatch` tracks `queued` / `sent` / `failed` / `skipped`, with duplicate skip unless `force=true`

### Voting
- Session types: `administrator_election`, `motion`
- Status: `draft` / `active` / `closed`
- Options default to yes / no / abstain, or a custom list on the session
- A designated voter who is a member of the apartment may cast one vote. A second submission is rejected. Votes are not editable

### Operations
- Dev: `docker compose` — frontend `8081`, API `8001`, Postgres, unused Redis
- Prod: `docker-compose.prod.yml` — frontend `127.0.0.1:3000`, API `127.0.0.1:8000`, Postgres private, host nginx + Certbot
- Deploy: `./deploy-production.sh`
- Measurements screen can open a printable sheet

## Still open (Sprint 6)
- Redis is in the dev Compose file and is not used. Production Compose does not start Redis. There is no response cache
- No backup/restore runbook beyond the empty `backups/` directory
- No end-to-end browser suite. Backend tests live in `backend/flats/tests.py` and `backend/accounts/tests.py`
- English locale is a `preferred_language` field and `SUPPORTED_LOCALES`. The UI, PDFs, and emails are Greek
- Election results do not assign the administrator
- User, apartment, and membership creation is Django admin, not the Angular app
- `invite-preview.html` at the repo root is an untracked local mail mock and is not part of the app
