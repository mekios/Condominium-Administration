# Block-of-Flats Admin: Sprint Delivery Plan

## Planning principles
- Each sprint ends with a usable release candidate.
- Sprints are vertical slices (backend + frontend + data + docs + deploy updates).
- Greek (`el`) is the default language in all user-facing outputs in MVP.
- Scope follows current docs (`01`..`07`) and priorities: accounting correctness, access control, and tenant usability.

## Cadence
- Suggested sprint length: 2 weeks.
- Suggested release cadence: one tagged release per sprint (`v0.x`).

## Sprint 1 - Foundation + Auth + Apartment Scoping
### Goal
Stand up the platform and provide secure login with apartment-scoped read access.

### Build
- Repo scaffold:
  - `backend/` Django + DRF project
  - `frontend/` Angular app
  - root `docker-compose.yml` with `postgres`, `redis`, `backend`, `frontend`
- Core models:
  - `Building`, `Apartment` (with `ownership_permille`), `User`, `ApartmentUser`, `DesignatedVoter`
- AuthN/AuthZ:
  - JWT login/refresh
  - role model (`superadmin`, `administrator`, regular)
  - apartment-scoped queryset filtering
- Basic frontend:
  - login page
  - protected app shell
  - simple dashboard showing linked apartments

### Usable delivery
- Users can log in and see only their linked apartment data shell.
- Superadmin can create users/apartments and membership links via admin/API.

### Exit criteria
- Dockerized stack runs locally.
- Apartment scoping verified (no cross-apartment leaks).

---

## Sprint 2 - Measurements + Expense Entry + First Invoice Generation
### Goal
Admin can enter month data and generate first invoice totals.

### Build
- Measurement flows:
  - heating inputs (`e_factor`, `f_factor`, `units_counted`, billing period)
  - heated-water volume inputs (billing period + `inputs_json` schema placeholder)
- Expense flows:
  - categories including `gas_heating_bill`, `water_consumption_bill`, common and non-recurring
- Allocation engine v1:
  - ownership-permille allocations for common/non-recurring expenses
  - month bucketing and retroactive edits support
- Invoice generation endpoint + minimal invoice list/detail UI

### Usable delivery
- Administrator can enter data for a month and generate per-apartment invoices.
- Tenants can view invoice totals and breakdown for linked apartments.

### Exit criteria
- Re-run invoice generation after edits and totals update deterministically.

---

## Sprint 3 - Heating Formula + Gas/Water Split Correctness
### Goal
Implement the exact heating formula and billing split behavior end-to-end.

### Build
- Formula implementation:
  - `((fi * ei) + (UnitsCounted / SumOfUnitsCounted) * (1 - Sum(fi * ei))) * gas_radiator_amount`
- Gas split + allocations:
  - single gas bill split into radiator and heated-water energy portions
  - radiator part allocated with formula shares
  - heated-water energy part allocated by heating-water volume
- Water bill split:
  - `water_consumption_bill` allocated by heating-water volume shares
- Validation rules:
  - `sum_units_counted > 0`
  - `0 <= sum(fi*ei) <= 1`
  - missing expense month behavior (`0` for absent commodity bills)
- UI breakdown updates:
  - `heating_radiators_total`, `heated_water_energy_total`, `water_consumption_total`

### Usable delivery
- Month invoices are mathematically aligned with your declared formula and split rules.

### Exit criteria
- Sample fixture scenarios pass expected totals.

---

## Sprint 4 - Payments + Paid State + Receipt PDFs/Emails
### Goal
Complete settlement workflow for real monthly operations.

### Build
- Payment module:
  - record payments, compute outstanding
  - mark invoice as paid
- Document generation:
  - invoice PDF + receipt PDF templates (Greek)
  - `InvoiceDocument` persistence
- Notifications:
  - automated paid receipt email with PDF attachment
  - `NotificationDispatch` tracking (`queued/sent/failed`)
- UI:
  - admin payments flow
  - tenant invoice payment history view

### Usable delivery
- Admin can close an invoice as paid and tenant receives receipt email + PDF.

### Exit criteria
- Duplicate receipt protection works unless explicit resend.

---

## Sprint 5 - Voting + Elections + Monthly Invoice Emailing
### Goal
Enable governance and communication cycle.

### Build
- Voting sessions:
  - motions + annual election session types
  - one vote per apartment, designated voter only, deadline enforcement
- Results computation and auditability
- Monthly invoice distribution:
  - bulk send invoice emails per apartment with attached PDF
  - dispatch status dashboard for admin
- UI:
  - voting list/detail/cast flow
  - admin “Send monthly invoices” flow

### Usable delivery
- Residents can vote in active sessions.
- Admin can send monthly invoices automatically by email.

### Exit criteria
- Security checks confirm no double-vote and no non-designated voting.

---

## Sprint 6 - Hardening + Greek UX polish + Production Readiness
### Goal
Stabilize for dependable real-world use.

### Build
- Security hardening:
  - stricter object-level checks
  - PDF access controls (no public static links)
  - audit/report endpoints
- i18n foundation:
  - Greek primary (`el`) complete across UI, PDFs, email templates
  - English locale hooks prepared (`en`, not fully translated yet)
- Operational hardening:
  - backup/restore docs
  - observability/logging improvements
  - retry policy for notification failures
- QA:
  - end-to-end smoke tests for monthly cycle
  - performance checks for invoice generation and sending

### Usable delivery
- Stable, production-ready v1 for single-building operation in Greek with full monthly workflow.

### Exit criteria
- UAT sign-off for a complete month: measurements -> expenses -> invoices -> payment -> receipt -> voting.

---

## Definition of done per sprint
- Feature demo in running Docker stack.
- Updated docs (requirements/API/UI/security/ops impacted by changes).
- Basic automated test coverage for the sprint’s critical logic.
- Release notes and migration notes (if schema changed).

## Suggested milestones
- `v0.1` after Sprint 1
- `v0.2` after Sprint 2
- `v0.3` after Sprint 3
- `v0.4` after Sprint 4
- `v0.5` after Sprint 5
- `v1.0` after Sprint 6
