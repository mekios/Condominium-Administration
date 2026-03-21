# Block-of-Flats Admin: UI Flows (Angular)

## 1. General UI principles
- UI locale defaults to Greek (`el`) for MVP.
- All visible labels/messages, invoice/receipt previews, and notification text are Greek-first.
- App must be i18n-ready so English (`en`) can be introduced later without reworking route/data models.
- Use route guards:
  - regular users can only navigate to screens whose data they are allowed to see
  - designated voter actions are enabled only when the backend confirms the user is designated voter for the apartment
- Use a consistent “month context selector” across accounting screens:
  - default to current month
  - allow selecting past months (admin especially)
- Use “apartment picker” only where required:
  - for regular users, apartment list is derived from `ApartmentUser` links

## 2. Shared layout
Suggested Angular routes:
- `/` (redirect to dashboard)
- `/login`
- `/dashboard`
- `/invoices`
- `/invoices/:invoiceId`
- `/voting`
- `/voting/sessions/:sessionId`
- `/admin`
  - `/admin/measurements`
  - `/admin/expenses`
  - `/admin/payments`
  - `/admin/voting-sessions`
  - `/admin/elections` (optional, if separate from voting sessions)
  - `/admin/apartments` (superadmin-only)

## 3. Authentication flow
### 3.1 Login
User actions:
- enters email/password (or invite-based flow; TBD)
Backend actions:
- returns JWT access token (+ refresh token if used)
UI behavior:
- stores token in memory or secure storage
- fetches `/me` (or equivalent) to load role + apartment links + designated voter summary (if you expose it)

## 4. Tenant/owner flows (regular users)

### 4.1 Dashboard (monthly status)
Purpose:
- Show per-linked-apartment status for the selected month.
UI data needs:
- For each linked apartment:
  - invoice outstanding balance and paid total
  - a component breakdown summary (radiator heating/heated-water energy/water consumption + common expenses)
  - (optional) last activity timestamps (e.g., last invoice regen)
Actions:
- user can navigate to invoice details
APIs:
- `GET /stats/monthly/?month=YYYY-MM` or `GET /invoices/?month=YYYY-MM`

### 4.2 Invoices list
Purpose:
- list invoices for selected month across the apartments the user belongs to.
UI data needs:
- invoice totals, outstanding balances, payment status
Actions:
- click invoice to see details
APIs:
- `GET /invoices/?month=YYYY-MM`

### 4.3 Invoice detail
Purpose:
- show charge breakdown and payment history.
UI data needs:
- `heating_radiators_total`, `heated_water_energy_total`, `water_consumption_total`, category totals, invoice_total
- payments list: date/amount/reference
- computed `outstanding_balance`
APIs:
- `GET /invoices/:invoiceId/`
- `GET /invoices/:invoiceId/payments/`

### 4.4 Voting: sessions list
Purpose:
- show active and upcoming sessions (motions and annual election).
UI data needs:
- session title/description
- session status (active/closed)
- voting deadline displayed
APIs:
- `GET /voting/sessions/`

### 4.5 Voting: session detail and cast vote
Purpose:
- allow designated voter to cast/change vote until deadline.
UI data needs:
- session metadata (start/end, description)
- current user’s votes for apartments they are linked to
- results preview if session is closed
Actions:
- If user is designated voter for apartment:
  - show vote controls (e.g., Yes/No/Abstain)
  - allow changing until `end_at`
  - show “Your vote saved”
- If user is not designated voter:
  - show the apartment list with read-only “vote not editable”
APIs:
- `GET /voting/sessions/:sessionId/`
- `GET /voting/sessions/:sessionId/votes/` (scoped)
- `POST /voting/sessions/:sessionId/votes/` or `PUT ...`
- `GET /voting/sessions/:sessionId/results/`

## 5. Administrator flows (elevated access)

### 5.1 Admin entry point
Purpose:
- show admin panel only if user has active `AdministratorTerm` or is `superadmin`.
Actions:
- navigate to measurements/expenses/payments and voting session management

## 6. Admin flows: measurements

### 6.1 Month-based measurement history
Purpose:
- browse measurement coverage month-by-month and inspect details.
UI data needs:
- month rows with counts (`heating_entries`, `heated_water_entries`, `apartments_total`)
- expandable month detail rows per apartment
Actions:
- open a month row and inspect previous/current/diff values for both commodities
APIs:
- `GET /accounting/heating-inputs/months/`
- `GET /accounting/heating-inputs/month-detail/?month=...`

### 6.2 New monthly measurement entry (single combined form)
Purpose:
- enter new monthly readings for all apartments in one form.
UI behavior:
- default month is backend-provided `suggested_next_month`
- one table row per apartment with:
  - previous heating reading (read-only)
  - current heating reading (input)
  - computed heating units (read-only, diff)
  - previous hot-water reading (read-only)
  - current hot-water reading (input)
  - computed hot-water units (read-only, diff)
- `billing_period_start` and `billing_period_end` are declared once per month form

Rules:
- No separate “heating page” and “hot-water page”; both commodities are entered together.
- Units are always derived from current minus previous reading.
- Apartment thermal factors (`e/f`) are not entered in this monthly form (maintained in apartment master data by superadmin).

APIs:
- `GET /accounting/heating-inputs/entry-form/?month=...`
- `POST /accounting/heating-inputs/monthly-upsert/`

## 7. Admin flows: expenses

### 7.1 Expenses list and create
Purpose:
- record expense items for a selected month.
UI data needs:
- existing expenses for month
- category dropdown
- total sums (optional)
Actions:
- add expense with:
  - category
  - expense date
  - affected measurement date range (`affected_period_start` / `affected_period_end`) when category is heating gas or water-consumption bill
  - amount
  - description
- edit past entries
APIs:
- `GET /accounting/expenses/?month=...`
- `POST /accounting/expenses/`
- `PATCH /accounting/expenses/:expenseId/`

### 7.2 Allocation preview (optional but useful)
Purpose:
- show computed allocated amounts per apartment while the admin fills expenses (draft billing preview).
UI data needs:
- per apartment allocated component totals
APIs:
- `GET /invoices/preview/?month=YYYY-MM`

## 8. Admin flows: invoices

### 8.1 Generate/regenerate invoices for month
Purpose:
- create or refresh invoices for a month after measurement/expense updates.
UI data needs:
- list month invoices and status
Actions:
- press “Generate invoices”
- press “Send monthly invoices” to trigger automated emails
- show confirmation if affected months change due to retroactive edits
APIs:
- `POST /invoices/generate/` with `{ "month": "YYYY-MM" }`
- `POST /invoices/send-monthly-email/` with `{ "month": "YYYY-MM" }`

### 8.2 Payment entry
Purpose:
- record payments against an invoice.
Actions:
- select apartment invoice
- enter payment date/amount/reference
- mark invoice as paid when outstanding reaches `0`
- system sends receipt email with PDF automatically after marking paid
APIs:
- `GET /invoices/:invoiceId/` (context)
- `GET /accounting/payments/?month=YYYY-MM`
- `POST /accounting/payments/`
- `POST /invoices/:invoiceId/mark-paid/`
- `POST /invoices/:invoiceId/send-receipt/` (resend with duplicate protection)

### 8.3 Tenant payment history
Purpose:
- allow tenants/owners to track settlements for linked apartments.
Actions:
- filter by month
- review amount/date/method/reference history
APIs:
- `GET /accounting/payments/?month=YYYY-MM`

## 9. Admin flows: voting sessions

### 9.1 Create/manage motion
Purpose:
- create arbitrary motions with start/end deadlines.
UI actions:
- choose motion title/description
- set start_at and end_at
- open motion
APIs:
- `POST /voting/sessions/`
- `PATCH /voting/sessions/:sessionId/`

### 9.2 Election session management
Purpose:
- handle the annual administrator election session.
Policy:
- The admin-election winner is derived from votes and mapped to `AdministratorTerm`.
UI actions:
- ensure the election session is active during the voting window
- after end, show computed winner and confirm term assignment
APIs:
- `POST /voting/sessions/` with `session_type=administrator_election`
- `GET /voting/sessions/:sessionId/results/`

## 10. Superadmin flows (separate from admin)
Covered in a future doc section; at minimum, include:
- manage apartment ownership permille and membership
- set designated voter for each apartment

