# Block-of-Flats Admin: UI Flows

Greek labels are the product UI. Routes live in `frontend/src/app/app.routes.ts`. The visual reference is the dark admin dashboard in the frontend Figma rule.

## 1. Shell
Authenticated pages render inside `AdminShellComponent` at `/app`.

Sidebar:
- Πίνακας ελέγχου → `/app/dashboard`
- Λογαριασμοί → `/app/invoices`
- Έξοδα → `/app/expenses`
- Στατιστικά → `/app/statistics`
- Μετρήσεις → `/app/measurements`
- Ψηφοφορίες → `/app/voting`
- Profile chip → `/app/profile`

Top bar: username and role, **Λειτουργία διαχειριστή** for role `administrator` (sessionStorage), always-on management for `superadmin`, and logout.

`/app/payments` and `/app/analysis` are routed. Analysis is opened from the dashboard. Payments is not a sidebar item.

Guards:
- `authGuard` on `/app` and `/set-password`
- `passwordChangeGuard` sends a user with `must_change_password` to `/set-password`
- `adminOnlyGuard` on expense create/edit routes

## 2. Auth
- `/login` — username and password, then `/api/token/` and `/api/me/`
- `/forgot-password` — asks for an email reset
- `/reset-password` — sets a password from the email token
- `/set-password` — required before the shell when the invite flag is set

Tokens are stored by `AuthService` and attached by the auth interceptor.

## 3. Dashboard (`/app/dashboard`)
Shows the caller’s apartments, unpaid or latest invoices, measurement charts, and the building reserve.

Remaining capital = reserve − ανεξόφλητα (apartment outstanding, excluding fund-only months still unpaid) − τρέχοντα έξοδα (unbilled operating expenses + all `fund_increase`) + ανεξόφλητα έξοδα (`is_paid=false`, excluding `fund_increase`). `fund_increase` never changes ταμείο; issuing a fund-only month keeps the same υπόλοιπο. Admins in management mode can patch `fund_balance` inline.

A personalized greeting uses the profile name. Invoice PDF download is available from the invoice cards. The analysis screen is opened from here.

## 4. Invoices (`/app/invoices`)
Month picker. Lists invoices in scope with component totals, custom adjustment, paid and outstanding amounts.

Admin mode:
- generate / regenerate the month, including per-apartment adjustments
- send monthly invoice emails
- mark paid and resend a receipt
- recall the month (confirm). That deletes invoices, payments, and stored PDFs for the month
- download invoice or receipt PDF

Residents see linked apartments and can download PDFs they are allowed to read.

## 5. Expenses
`/app/expenses` lists the month with category icons. Draft billing preview calls `GET /api/invoices/preview/`.

`/app/expenses/new` and `/app/expenses/:id` are admin-only. The form collects category, date, amount, description, and the affected measurement range for gas and hot-water bills. Fund-increase rows update the building reserve on save.

## 6. Statistics (`/app/statistics`)
Building expense totals for every signed-in user. Data comes from `GET /api/accounting/expenses/`. The window is the latest 12 months that have expenses, or fewer when history is shorter. Every chart shares that month axis.

The first chart is **Σύνολο εξόδων**, a line of all expenses in each month. Each other category is its own line in the category color, with the category icon. **Ζημιές** is one solid bar per month, not a line. **Αποθεματικό** is the building reserve at each month (`fund_balance`, with later top-ups removed), not the monthly increase. A category with no amount in the window is hidden.

**Θέρμανση** is the sum of apartment heating `units_counted` (kWh) per month. **Ζεστό νερό** is the sum of `computed_heating_water_volume` (m³) per month. **Θέρμανση ζεστού νερού** is the boiler `hot_water_heating_units` (kWh) from `GET /api/accounting/heating-inputs/building-hot-water/`. The first reading of each apartment and of the boiler is a meter baseline and is left out, matching the dashboard. These charts use the latest 12 months that have readings.

## 7. Measurements (`/app/measurements`)
One screen for heating, apartment hot water, and the building boiler.

- Date list from `GET /api/accounting/heating-inputs/dates/`
- Open a date to see previous / current / delta per apartment
- Entry form defaults to the next date after the latest stored date
- One `measurement_date` for the whole sheet. Factors `e` / `f` are not entered here
- Admin mode can save (`monthly-upsert`) and delete a date (`by-date`)
- Print opens a Greek measurement sheet in a new window

A date cannot be edited after invoices exist for that month.

## 8. Payments (`/app/payments`)
Month-filtered payment history. Admin mode can record a payment against an invoice and delete one. Recording a payment stores a receipt PDF and sends the receipt email. Residents only see payments for linked apartments.

## 9. Analysis (`/app/analysis`)
Month view of how invoice totals split across apartments (`GET /api/invoices/analysis-share/`) and the expense mix for that month. Opened from the dashboard.

## 10. Voting
`/app/voting` lists sessions (active and inactive). `/app/voting/:id` is the detail page.

A designated voter of a linked apartment submits one option while the session is active and inside the window. The vote cannot be changed. Closed sessions show result counts.

Admin mode can create a session (building, type, title, description, window, status, optional comma-separated options), edit it, and move status among draft, active, and closed.

Election results do not change the administrator role.

## 11. Profile (`/app/profile`)
Name, email, preferred language, and password change via `/api/me/`.

## 12. What stays in Django admin
User invites, apartment records, membership flags, ownership permille, and designated-voter setup. The Angular app reads those records. It does not replace `/admin/` for them.
