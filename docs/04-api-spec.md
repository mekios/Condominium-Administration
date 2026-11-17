# Block-of-Flats Admin: API Specification

Base path: `/api/`. JSON. Auth header: `Authorization: Bearer <access>`.

Greek (`el`) is the language of API error text, PDFs, and emails. `User.preferred_language` exists for a later English locale. Responses are not translated.

Redis caching described in older drafts is not implemented.

## 1. Authentication

| Method | Path | Auth | Behavior |
|---|---|---|---|
| POST | `/api/token/` | public | JWT access + refresh (`username`, `password`) |
| POST | `/api/token/refresh/` | public | New access token |
| GET, PATCH | `/api/me/` | user | Profile. PATCH updates name, email, preferred language, or password |
| POST | `/api/me/set-password/` | user | First-login password. Clears `must_change_password` |
| POST | `/api/auth/forgot-password/` | public | Emails a reset link when the account exists |
| POST | `/api/auth/reset-password/` | public | Consumes the reset token |

Invites are not a REST endpoint. Django admin creates the user and sends a temporary password (`accounts.invite`).

## 2. Who can do what

- `superadmin`: all reads and writes below, plus designated-voter assignment.
- `administrator`: the same accounting and voting writes. Cannot set the designated voter.
- `user`: linked apartments only, plus building-scoped invoice reads when `building_scope=1`. Vote only as designated voter of a linked apartment.

Frontend **Λειτουργία διαχειριστή** does not change these checks.

## 3. Buildings and apartments

| Method | Path | Who |
|---|---|---|
| GET | `/api/buildings/` | authenticated |
| GET | `/api/buildings/{id}/` | authenticated |
| PATCH | `/api/buildings/{id}/` | admin. Body may set `fund_balance` |
| GET | `/api/apartments/` | linked apartments. `?all=1` returns every apartment for admin roles |
| GET | `/api/apartments/{id}/` | same scope |
| PATCH | `/api/apartments/{id}/heating-factors/` | admin. Body: `heating_e_factor`, `heating_f_factor` |
| PUT | `/api/apartments/{id}/designated-voter/` | superadmin. Body: `{ "voter_user_id": 123 }`. Voter must be a member |

Creating users, apartments, and memberships is Django admin (`/admin/`), not these routes.

## 4. Measurements

Workflow (the UI uses these):

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/accounting/heating-inputs/dates/` | authenticated (building scope) | Date list and coverage |
| GET | `/api/accounting/heating-inputs/building-hot-water/` | same | Boiler `hot_water_heating_units` per measurement date |
| GET | `/api/accounting/heating-inputs/date-detail/?measurement_date=YYYY-MM-DD` | same | Apartment rows for that date |
| GET | `/api/accounting/heating-inputs/entry-form/` | same | Previous readings for the next entry. Optional date query |
| POST | `/api/accounting/heating-inputs/monthly-upsert/` | admin | One date, all apartment rows, plus the boiler reading |
| DELETE | `/api/accounting/heating-inputs/by-date/?measurement_date=YYYY-MM-DD` | admin | Deletes heating, hot water, and boiler rows for that date. Rejected when invoices exist for that month |

`monthly-upsert` body:

```json
{
  "measurement_date": "2026-08-01",
  "hot_water_heating_current_reading": "1500.0",
  "rows": [
    { "apartment_id": 10, "heating_current_reading": "120.5", "heated_water_current_reading": "44.0" }
  ]
}
```

The server computes unit deltas and copies `e_factor` / `f_factor` from the apartment. Negative deltas return 400.

Low-level routes still exist for heating and heated-water viewsets: list, create, partial update, destroy, and `POST .../bulk-upsert/`. Deletes are admin-only.

## 5. Expenses

| Method | Path | Who |
|---|---|---|
| GET | `/api/accounting/expenses/?month=YYYY-MM` | admin: all. Resident: building expenses for linked buildings |
| POST | `/api/accounting/expenses/` | admin |
| PATCH | `/api/accounting/expenses/{id}/` | admin |
| DELETE | `/api/accounting/expenses/{id}/` | admin |

Create body: `expense_category`, `expense_date`, `amount`, optional `description`. Gas and hot-water bills also send `affected_period_start` and `affected_period_end`.

`fund_increase` updates `Building.fund_balance` inside the same transaction. Category rules are in `docs/03-accounting-rules.md`.

## 6. Invoices

| Method | Path | Who | Behavior |
|---|---|---|---|
| GET | `/api/invoices/?month=YYYY-MM` | scoped | Admin: all. Resident: linked apartments. `personal_scope=1` forces linked apartments. `building_scope=1` returns the caller’s buildings |
| GET | `/api/invoices/{id}/` | scoped | One invoice |
| GET | `/api/invoices/preview/?month=YYYY-MM` | admin | Draft rows, not saved |
| GET | `/api/invoices/analysis-share/?month=YYYY-MM` | authenticated | Each apartment’s share of that month’s invoice totals |
| POST | `/api/invoices/generate/` | admin | Create or update the month. Optional `adjustments`: `[{ "apartment_id", "custom_adjustment", "custom_adjustment_note" }]` |
| POST | `/api/invoices/send-monthly-invoices/` | admin | Body `{ "month", "force": false }`. PDF attached. Duplicate sends are `skipped` unless `force` is true |
| POST | `/api/invoices/retry-failed-notifications/` | admin | Optional `month`, `notification_type`, `dispatch_id` |
| POST | `/api/invoices/{id}/mark-paid/` | admin | Optional amount pays the outstanding balance. Writes a payment, receipt PDF, and receipt email |
| POST | `/api/invoices/{id}/send-receipt/` | admin | Body `{ "payment_id", "force": false }` |
| GET | `/api/invoices/{id}/download-pdf/` | scoped | Invoice PDF attachment |
| GET | `/api/invoices/{id}/download-receipt/` | scoped | Latest receipt PDF |
| POST | `/api/invoices/recall-month/` | admin | Body `{ "month", "confirm": true }`. Deletes that month’s invoices, payments, and documents |

Generate response includes `month`, `created`, `updated`, and `warnings`.

There is no per-invoice `POST /recall/`, no `/payments/` nested under an invoice, and no `/stats/monthly/`.

Representative invoice fields: `heating_radiators_total`, `heated_water_energy_total`, `water_consumption_total`, `common_recurring_total`, `common_non_recurring_total`, `owners_only_total`, `custom_adjustment`, `custom_adjustment_note`, `invoice_total`, `paid_total`, `outstanding_balance`, `status` (`draft` | `issued` | `paid`).

## 7. Payments

| Method | Path | Who |
|---|---|---|
| GET | `/api/accounting/payments/?month=YYYY-MM` | admin: all. Resident: linked apartments |
| POST | `/api/accounting/payments/` | admin. Body: `invoice`, `amount`, `payment_date`, `method`, optional `reference`, `notes` |
| DELETE | `/api/accounting/payments/{id}/` | admin. Recalculates the invoice and deletes that payment’s receipt documents |

`method`: `cash`, `bank_transfer`, `card`, `other`.

## 8. Voting

| Method | Path | Who |
|---|---|---|
| GET, POST | `/api/voting/sessions/` | GET: sessions in the caller’s buildings (admin: all). POST: admin |
| GET, PATCH, PUT, DELETE | `/api/voting/sessions/{id}/` | writes: admin |
| GET, POST | `/api/voting/sessions/{id}/votes/` | GET is scoped. POST body `{ "apartment_id", "vote_value" }` |
| GET | `/api/voting/sessions/{id}/results/` | counts after the session is closed |

Vote checks:
- Caller is an `ApartmentUser` and the `DesignatedVoter` for that apartment.
- Session `status` is `active` and `now` is inside `start_at`..`end_at`.
- `vote_value` matches `vote_options_json`, or `yes` / `no` / `abstain` when that list is empty.
- A second vote for the same apartment returns 409. Votes are not updated in place.

Session create fields: `building`, `session_type` (`motion` | `administrator_election`), `title`, `description`, `vote_options_json`, `start_at`, `end_at`, `status`.

## 9. Invariants
- `unique(vote_session, apartment)` and `unique(apartment, month)` on invoices.
- `unique(apartment, measurement_date)` on heating and hot-water rows. `unique(building, measurement_date)` on boiler rows.
- List and detail querysets are filtered from the authenticated user. Client-supplied apartment ids are not trusted for authorization.
- Invoice math uses the stored inputs and the rounding in `docs/03-accounting-rules.md`.
