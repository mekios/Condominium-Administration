# Block-of-Flats Admin: API Specification (Django REST Framework)

## 1. Overview
The backend exposes a JSON REST API consumed by the Angular frontend.

Design principles:
- Apartment-scoped data access for all accounting and voting resources.
- Deterministic invoice computation from stored inputs.
- Redis caching for computed month stats and invoice totals (cache keys include apartment and month).
- All vote submissions are validated against the designated voter and “one vote per apartment per session” constraints.
- MVP localization policy: Greek (`el`) is the default output locale for API-rendered templates (emails/PDF payload metadata). API is designed for later English (`en`) support.

## 2. Authentication
TBD in implementation; for now assume:
- Users authenticate using JWT.
- `Authorization: Bearer <token>` is required for all `/api/` endpoints except login/refresh.

## 3. Permission matrix (who can do what)

Terminology:
- “Linked apartment” means `request.user` has an `ApartmentUser` link for that apartment.
- “Designated voter” means `request.user` matches the `DesignatedVoter` user for a target apartment.
- “Administrator” means the user has an active `AdministratorTerm` for the current year/term (exact term-window rules TBD).

Permissions:
- `superadmin`
  - Manage: users, apartment-user links, apartment ownership permille, designated voters
  - Create: elections and motions
  - Enter: heating/heated-water inputs, expenses, payments
  - Generate/regenerate invoices
  - Can view all apartments’ data
- `administrator`
  - Create: motions (and administrative election sessions via policy)
  - Enter: measurements, expenses, payments
  - Generate/regenerate invoices
  - View all apartments’ accounting data (but voting submission still uses designated voter constraints)
  - Can view all votes for sessions they manage (or all sessions; choose one)
- tenant/owner (regular user)
  - Read: invoices, invoice balances, and month stats only for linked apartments
  - Vote: only as designated voter for each apartment (one vote per session)
  - Cannot read or mutate measurements/expenses/payments for other apartments

### 3.1 Apartment list scoping
- `GET /apartments/` returns only apartments linked to the current user (`ApartmentUser` membership).
- `GET /apartments/?all=1` returns all building apartments for `superadmin` and `administrator` only (used by management screens).

### 3.2 Frontend admin mode (UI policy)
- `superadmin`: management write controls are always visible in the UI.
- `administrator`: management write controls (measurements, expenses, invoices, payments, voting setup) are shown only after the user toggles **Λειτουργία διαχειριστή** in the app shell.
- Admin mode state is stored in browser `sessionStorage` and does not change backend authorization (API still checks role server-side).

## 4. Common query conventions
- Apartment scoping:
  - List endpoints return only items accessible to the user.
  - For “read invoice” endpoints, the server filters by linked apartments.
- Month scoping:
  - `month` is typically a `YYYY-MM` string.

## 5. Resources and endpoints

### 5.1 Users and apartments (superadmin only)
Base: `/api/`

1. `GET /users/` (superadmin)
2. `POST /users/` (superadmin)
3. `PATCH /users/{userId}/` (superadmin)
4. `GET /apartments/` (superadmin)
5. `POST /apartments/` (superadmin)
6. `PATCH /apartments/{apartmentId}/` (superadmin)
   - includes `ownership_permille`

Apartment-user links:
1. `GET /apartments/{apartmentId}/members/` (superadmin)
2. `POST /apartments/{apartmentId}/members/` (superadmin)
3. `PATCH /apartments/{apartmentId}/members/{userId}/` (superadmin)
   - includes `is_owner`, `is_tenant`

Designated voter:
1. `PUT /apartments/{apartmentId}/designated-voter/` (superadmin)
   - body: `{ "voter_user_id": 123 }`
   - acceptance: designated voter must be a member of that apartment

### 5.2 Accounting: measurements

Primary monthly workflow endpoints:
1. `GET /accounting/heating-inputs/months/`
   - returns month summary list:
     - `{ items: [{ month, heating_entries, heated_water_entries, apartments_total }], suggested_next_month }`
2. `GET /accounting/heating-inputs/month-detail/?month=YYYY-MM`
   - returns apartment rows for the selected month including:
     - previous/current readings and computed unit deltas for both commodities
3. `GET /accounting/heating-inputs/entry-form/?month=YYYY-MM` (month optional)
   - returns entry rows for all visible apartments and previous readings
   - if `month` is missing, backend chooses next month after latest available data
4. `POST /accounting/heating-inputs/monthly-upsert/` (administrator, superadmin)
   - body (example):
     - `{
         "measurement_date": "2026-08-01",
         "rows": [
           { "apartment_id": 10, "heating_current_reading": "120.5", "heated_water_current_reading": "44.0" }
         ]
       }`
   - backend computes:
     - `heating_units_counted = heating_current_reading - previous_heating_reading`
     - `computed_heating_water_volume = heated_water_current_reading - previous_heated_water_reading`
   - negative deltas are rejected with validation error
   - `e_factor`/`f_factor` are copied from apartment master data snapshots (not entered monthly in UI)

Low-level/legacy endpoints (still available for internal/admin use):
- `GET|POST|PATCH|DELETE /accounting/heating-inputs/` (DELETE: administrator, superadmin)
- `GET|POST|PATCH|DELETE /accounting/heated-water-inputs/` (DELETE: administrator, superadmin)
- `DELETE /accounting/heating-inputs/by-date/?measurement_date=YYYY-MM-DD` (administrator, superadmin)
  - deletes all heating and heated-water rows for that measurement date across visible building apartments
  - rejected when invoices for that calendar month have recorded payments
- `POST /accounting/heating-inputs/bulk-upsert/`
- `POST /accounting/heated-water-inputs/bulk-upsert/`

Server behavior:
- Persist monthly readings and computed unit deltas.
- For radiator heating allocations, apply:
  - `((fi * ei) + (UnitsCounted / SumOfUnitsCounted) * (1 - Sum(fi * ei))) * gas_radiator_amount`
- Mark affected month as dirty for invoice recalculation.

### 5.3 Accounting: expenses

1. `GET /accounting/expenses/?month=YYYY-MM`
   - admin/superadmin see all; regular users either have read-only aggregated stats or none (choose based on UI needs)
2. `POST /accounting/expenses/` (administrator, superadmin)
   - body:
     - `{ "expense_category": "cleaning", "expense_date": "2026-03-15", "amount": "123.45", "description": "..." }`
     - for `gas_heating_bill` and `water_consumption_bill`, include:
       - `"affected_period_start": "2026-02-01"`
       - `"affected_period_end": "2026-03-01"`
3. `PATCH /accounting/expenses/{expenseId}/` (administrator, superadmin)
4. `DELETE /accounting/expenses/{expenseId}/` (administrator, superadmin)

Allocation:
- On create/update of an expense item, system recomputes allocated expenses per apartment for its accounting month.

- Allocation depends on `expense_category`:
  - `gas_heating_bill`:
    - admin declares `affected_period_start` / `affected_period_end`
    - split into radiator-heating vs heated-water-energy parts using energy percentages derived from measurements that overlap the affected range
    - allocate radiator-heating part by radiator-heating energy share
    - allocate heated-water-energy part by heating-water volume share
  - `water_consumption_bill`:
    - admin declares `affected_period_start` / `affected_period_end`
    - allocate to apartments by heating-water volume share from measurements that overlap the affected range
  - all other common recurring and non-recurring categories:
    - allocate by apartment ownership permille

### 5.4 Accounting: invoices and balances (read for tenants/owners)

1. `GET /invoices/?month=YYYY-MM`
   - regular users: only invoices for linked apartments
   - admin/superadmin: all invoices for that month
2. `GET /invoices/{invoiceId}/`
   - must verify apartment scoping

Invoice generation/regeneration:
1. `POST /invoices/generate/` (administrator, superadmin)
   - body: `{ "month": "2026-03" }`
   - behavior:
     - compute all components (radiator heating, heated-water energy, water consumption, common/non-recurring allocations) for that month
     - create/update invoices for all apartments in building
2. `GET /invoices/preview/?month=YYYY-MM` (administrator, superadmin)
   - behavior:
     - returns per-apartment draft component totals without persisting invoices
     - used by expenses UI for live "draft billing" preview while entering expenses
3. `POST /invoices/{invoiceId}/mark-paid/` (administrator, superadmin)
   - body (optional amount means "pay full outstanding"):
     - `{ "amount": "120.00", "payment_date": "2026-05-20", "method": "bank_transfer", "reference": "TX123", "notes": "..." }`
   - behavior:
     - creates payment record
     - updates `paid_total`, `outstanding_balance`, `status` (`paid` when balance reaches `0`)
     - generates receipt PDF and stores it
     - dispatches receipt email to apartment members with emails
4. `POST /invoices/{invoiceId}/send-receipt/` (administrator, superadmin)
   - body:
     - `{ "payment_id": 10, "force": false }`
   - behavior:
     - sends stored/generated receipt again
     - duplicate protection: returns conflict unless `force=true`
5. `POST /invoices/{invoiceId}/recall/` (administrator, superadmin)
   - body: `{ "confirm": true }` (required)
   - behavior:
     - deletes the invoice and cascades associated payments and stored PDF documents
     - invoice can be recreated later via `POST /invoices/generate/`

### 5.5 Accounting: payments
1. `GET /accounting/payments/?month=YYYY-MM`
   - admin/superadmin: all payments
   - regular users: only payments for linked apartments
2. `POST /accounting/payments/` (administrator, superadmin)
   - body:
     - `{ "invoice": 12, "amount": "50.00", "payment_date": "2026-05-20", "method": "cash", "reference": "..." }`
   - behavior:
     - records payment and updates invoice outstanding
     - generates/stores receipt PDF
     - sends receipt email and tracks dispatch status
3. `DELETE /accounting/payments/{paymentId}/` (administrator, superadmin)
   - behavior:
     - removes the payment and recalculates invoice `paid_total`, `outstanding_balance`, and `status`
     - deletes linked receipt PDF documents for that payment
2. `POST /invoices/{apartmentId}/regenerate/` (administrator, superadmin) (optional)
   - if you want per-apartment regeneration
3. `POST /invoices/send-monthly-email/` (administrator, superadmin)
   - body: `{ "month": "2026-03" }`
   - behavior:
     - generate/ensure per-apartment invoice PDFs
     - send one email per apartment with totals + invoice PDF attachment (Greek for MVP)
     - track dispatch status per recipient

### 5.5 Payments (admin write, user read)

1. `GET /invoices/{invoiceId}/payments/`
   - regular users can view payments for invoices they can access
2. `POST /invoices/{invoiceId}/payments/` (administrator, superadmin)
   - body:
     - `{ "payment_date": "2026-03-25", "amount": "50.00", "reference": "..." }`
3. `POST /invoices/{invoiceId}/mark-paid/` (administrator, superadmin)
   - behavior:
     - mark invoice status as paid (if outstanding is `0`)
     - generate receipt PDF (Greek for MVP)
     - send automated receipt email with PDF attachment to apartment recipients (Greek for MVP)
     - create dispatch audit log

### 5.6 Stats endpoints (optional but recommended)
1. `GET /stats/monthly/?month=YYYY-MM`
   - regular users: returns per-month summary for each linked apartment
   - uses Redis caching for computed totals

### 5.7 Voting

Vote sessions (motions + elections):
1. `GET /voting/sessions/` (regular users, admin, superadmin)
   - returns sessions visible to the user (for regular users: sessions for building; still enforce voting participation rules)
2. `GET /voting/sessions/{sessionId}/` (read)

Create/manage sessions:
3. `POST /voting/sessions/` (administrator, superadmin)
   - body:
     - `{ "session_type": "motion", "title": "...", "description": "...", "start_at": "...", "end_at": "..." }`
4. `PATCH /voting/sessions/{sessionId}/` (administrator, superadmin)
   - allow transitioning status: draft->active->closed (policy TBD)

Voting:
5. `GET /voting/sessions/{sessionId}/votes/` (regular users, admin)
   - regular users: returns only their linked apartments votes
   - admin: may return all votes (audit view)
6. `POST /voting/sessions/{sessionId}/votes/` (designated voter only)
   - body:
     - `{ "apartment_id": 10, "vote_value": "yes" }`
   - server checks:
     - user has ApartmentUser link for `apartment_id`
     - user is the designated voter for that apartment
     - session is active and `now <= end_at`
     - `unique(session_id, apartment_id)` constraint ensures one vote
7. `PUT /voting/sessions/{sessionId}/votes/{apartmentId}/` (optional for explicit update)

Server behavior for vote changes:
- Because a vote can be changed until deadline, update existing `Vote` row for that `(session_id, apartment_id)`.

Results:
8. `GET /voting/sessions/{sessionId}/results/`
   - returns aggregated counts after session ends

## 6. Request/response shapes (representative examples)

### 6.1 Invoice (representative JSON)
```json
{
  "id": 555,
  "apartment_id": 10,
  "month": "2026-03",
  "heating_radiators_total": "120.00",
  "heated_water_energy_total": "45.50",
  "water_consumption_total": "18.00",
  "common_recurring_total": "210.10",
  "common_non_recurring_total": "30.00",
  "invoice_total": "405.60",
  "status": "issued",
  "paid_total": "100.00",
  "outstanding_balance": "305.60"
}
```

### 6.2 Vote submission (designated voter)
```json
{
  "apartment_id": 10,
  "vote_value": "yes"
}
```

## 7. Validation and invariants (must-have)
- Vote invariants:
  - Exactly one vote per apartment per session: enforced by database unique constraint.
  - Voting authorization:
    - server must verify designated voter before accepting a vote.
  - Deadline enforcement:
    - server must check session `end_at` at time of submission.
- Apartment scoping invariants:
  - list and detail endpoints must never leak data for apartments not linked to the user.
- Allocation determinism:
  - invoice generation must be based on stored inputs and deterministic rounding rules.

## 8. Redis caching (where it applies)
- Cache computed monthly invoice totals and stats:
  - key pattern examples:
    - `invoice_totals:{apartment_id}:{month}`
    - `stats_month:{apartment_id}:{month}`
    - `session_results:{session_id}`
- Invalidation:
  - after updates to heating/heated-water inputs or expenses for month `m`, invalidate keys for that month and apartments.
  - after payment insert, invalidate invoice balance caches for that invoice.

Cache invalidation strategy is TBD (sync recompute vs async job + invalidate).

