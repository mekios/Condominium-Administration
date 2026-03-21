# Block-of-Flats Admin: Domain Model

## 1. Design goals
- Apartment-scoped authorization: all accounting and voting data is partitioned by `Apartment`.
- Deterministic allocations: invoice totals can be reproduced from stored inputs and allocation rules.
- One vote per apartment per session: enforced by both application logic and database constraints.
- Auditable changes: measurements, expenses, payments, invoices regeneration, and votes have an audit trail.

## 2. Core entities

### 2.1 `Building`
Represents the single condominium block (initially single-building; structure allows future extension).
- Fields (suggested):
  - `id`
  - `name`
  - `created_at`
  - `updated_at`

### 2.2 `Apartment`
Represents a flat/unit within the building.
- Fields (suggested):
  - `id`
  - `building_id` (FK -> `Building`)
  - `unit_code` (string, unique within building, e.g. `A-12`)
  - `owner_name` (string; primary owner display name, used in UI labels and documents)
  - `apartment_label` (derived display value, not necessarily persisted: `unit_code-owner_name_upper`, fallback `unit_code`)
  - `ownership_permille` (int or decimal, required; 0..1000)
  - `heating_e_factor` (decimal; apartment-level `ei`, maintained as master data)
  - `heating_f_factor` (decimal; apartment-level `fi`, maintained as master data)
  - `ownership_label` (optional display label)
  - `created_at`, `updated_at`

### 2.3 `User`
Represents a person account.
- Fields (suggested):
  - `id`
  - `email` (unique)
  - `first_name`, `last_name`
  - `is_active`
  - `created_at`, `updated_at`
  - `preferred_language` (string/enum; default `el`, future: `en`)

### 2.4 `ApartmentUser` (link + role flags)
Associates a `User` with an `Apartment`, created/managed by `superadmin`.
This is the main permission boundary for reading invoices/stats.
- Fields (suggested):
  - `id`
  - `apartment_id` (FK -> `Apartment`)
  - `user_id` (FK -> `User`)
  - `role_flags`:
    - `is_tenant` (bool)
    - `is_owner` (bool)
  - `created_at`, `updated_at`

Business rules (to be enforced):
- For a given building, the sum of `Apartment.ownership_permille` across all apartments should equal 1000 permille (or very close due to rounding). The system can validate this and provide warnings; strictness is TBD.
- A user can be linked to the same apartment multiple times: not allowed (`unique(apartment_id, user_id)`).

### 2.5 `DesignatedVoter` (per apartment)
Exactly one linked user is allowed to cast a vote for the apartment.
You can model this either as a field on `Apartment` or as its own table. This doc uses its own table for clarity.
- Fields (suggested):
  - `id`
  - `apartment_id` (FK -> `Apartment`, unique)
  - `voter_user_id` (FK -> `User`)
  - `effective_from` (date/time; optional but recommended for auditing)
  - `created_at`, `updated_at`

Business rules:
- One designated voter per apartment at any moment:
  - simplest constraint: `unique(apartment_id)` for “current designated voter”
  - optional: keep history with `effective_from` and enforce non-overlapping ranges (more complex; can be added later).
- The designated voter must have an `ApartmentUser` link for that apartment.

## 3. Administrator election and elevated access

### 3.1 `AdministratorTerm`
Represents which apartment/user has administrator elevated access for a year.
- Fields (suggested):
  - `id`
  - `building_id`
  - `term_year` (int)
  - `administrator_apartment_id` (FK -> `Apartment`)
  - `administrator_user_id` (FK -> `User`)
  - `start_date`, `end_date`
  - `created_from_vote_session_id` (FK -> voting session; optional)
  - `created_at`

Key policy (derived from your earlier requirement):
- Administrator election selects the winning apartment by votes.
- The administrator user is the designated voter of the winning apartment at election close (policy TBD if the designated voter changes immediately after).

### 3.2 `ElectionVoteSession` / `VoteSession` (unified model)
Voting sessions drive both arbitrary motions and the annual administrator election.
Model as a single table with a `session_type`.
- Fields (suggested):
  - `id`
  - `building_id`
  - `session_type` (enum: `administrator_election`, `motion`)
  - `title`
  - `description` (optional)
  - `start_at`
  - `end_at`
  - `status` (enum: `draft`, `active`, `closed`)
  - `created_by_user_id` (superadmin or administrator)
  - `created_at`, `updated_at`

### 3.3 `VoteOption` (optional)
If you want configurable vote options:
- Fields: `id`, `session_id`, `value`, `label`, `sort_order`

If you keep it fixed:
- Define fixed options for now (e.g. `yes/no/abstain`) and document it in API/docs.

### 3.4 `Vote`
Stores a single apartment vote for a session.
- Fields (suggested):
  - `id`
  - `vote_session_id` (FK -> `VoteSession`)
  - `apartment_id` (FK -> `Apartment`)
  - `voter_user_id` (FK -> `User`)  (must equal designated voter user at time of submission)
  - `vote_value` (enum/int)
  - `submitted_at`, `updated_at`

Constraints:
- `unique(vote_session_id, apartment_id)` to enforce one vote per apartment per session.

## 4. Accounting: measurements and computed usage

### 4.1 `AccountingMonth`
Optional helper entity; not strictly required if you derive from dates, but useful for API and invoice IDs.
- Fields:
  - `id`
  - `building_id`
  - `month` (e.g. `2026-03`)
  - `created_at`

### 4.2 `HeatingMeasurementInput`
Admin-entered raw inputs needed to compute individual heating usage.
Fields are aligned to the declared heating formula.
- Suggested minimum fields:
  - `id`
  - `building_id`
  - `apartment_id`
  - `accounting_month_id` (the month bucket used for the UI and invoices; always present)
  - `billing_period_start` (date; declared billing period this measurement set applies to)
  - `billing_period_end` (date; declared billing period this measurement set applies to)
  - `measurement_date` (optional; useful if you later support multiple readings within the same billing period)
  - `e_factor` (decimal; `ei`)
  - `f_factor` (decimal; `fi`)
  - `current_reading` (decimal; current month heating meter reading)
  - `units_counted` (decimal/int; apartment `UnitsCounted`)
  - `computed_radiator_heating_energy` (decimal; stored result for determinism)
  - `computed_at`
  - `created_by_user_id`

Notes:
- In UI and data-entry workflow, `e_factor`/`f_factor` are sourced from apartment master data and copied into the monthly measurement row as a deterministic snapshot (not manually re-entered each month).
- `units_counted` for a month is computed from readings:
  - `units_counted = current_reading - previous_month_current_reading`
- You may additionally store formula snapshots at billing-period level (`sum_units_counted`, `sum_fixed`) to make invoice recalculation fully reproducible.

### 4.3 `HeatedWaterMeasurementInput`
Admin-entered raw inputs for individual heated water usage allocation.
Exact fields depend on your distribution algorithm (to be provided later).
- Suggested shape:
  - `id`
  - `building_id`
  - `apartment_id`
  - `accounting_month_id` (the month bucket used for the UI and invoices; always present)
  - `billing_period_start` (date; declared billing period this measurement set applies to)
  - `billing_period_end` (date; declared billing period this measurement set applies to)
  - `inputs_json`
  - `current_reading` (decimal; current month hot-water meter reading)
  - `computed_heating_water_volume` (decimal; apartment hot-water volume used for splitting)
Rules:
- `computed_heating_water_volume` for a month is computed from readings:
  - `computed_heating_water_volume = current_reading - previous_month_current_reading`

  - `computed_at`
  - `created_by_user_id`

## 5. Accounting: expenses and allocations

### 5.1 `ExpenseItem`
Represents one expense line (recurring or one-off).
- Fields:
  - `id`
  - `building_id`
  - `expense_category` (enum: gardener, common_power, common_garden_water, cleaning, elevator_service, gas_heating_bill, water_consumption_bill, damages, annual_servicing, other TBD)
  - `expense_date` (date)
  - `accounting_month_id` (derived from `expense_date`)
  - `affected_period_start` (date, required for `gas_heating_bill` and `water_consumption_bill`)
  - `affected_period_end` (date, required for `gas_heating_bill` and `water_consumption_bill`)
  - `amount` (decimal, in currency major/minor units policy TBD)
  - `description` (optional)
  - `created_by_user_id`
  - `created_at`, `updated_at`

Allocation policy (from your plan):
- Common expenses are allocated proportionally to apartment ownership permille.
- Non-recurring categories follow a policy:
  - default in this doc: allocate by ownership permille (unless you later specify otherwise).

### 5.2 `AllocatedExpense`
Stores computed per-apartment allocations for an expense item and month.
Option A: store one row per (expense_item, apartment). Option B: store aggregated by category per apartment+month.
For performance and invoice regeneration, Option A is explicit; Option B is simpler.
- This doc suggests Option A initially:
  - `id`
  - `expense_item_id`
  - `apartment_id`
  - `accounting_month_id`
  - `allocated_amount` (decimal)
  - `allocation_version` (int; enables recomputation tracking)
  - `computed_at`

### 5.3 Invoice components (aggregation)
To keep invoice generation simple, you can also maintain:
- `ApartmentMonthlyCharges`:
  - `apartment_id`, `accounting_month_id`
  - `heating_amount`, `heated_water_amount`
  - category totals for common/non-recurring expenses
  - `computed_at`

This doc focuses on the underlying allocation inputs; aggregation table can be added after MVP.

## 6. Invoices and settlement

### 6.1 `Invoice`
Per apartment, per accounting month.
- Fields (suggested):
  - `id`
  - `apartment_id`
  - `accounting_month_id`
  - `currency` (optional; default store-wide)
  - `heating_radiators_total` (share of gas-energy portion for radiator heating)
  - `heated_water_energy_total` (share of gas-energy portion for heated water)
  - `water_consumption_total` (share of water consumption bill allocated by heating-water volume)
  - `common_recurring_total`
  - `common_non_recurring_total` (or a generic `other_total`)
  - `invoice_total`
  - `status` (draft/issued/finalized; “finalized” is optional but recommended)
  - `issued_at`, `updated_at`
  - `computed_from_allocation_version` (int)

Constraints:
- `unique(apartment_id, accounting_month_id)` ensures one invoice per month per apartment.

### 6.2 `Payment`
Records payments made toward an invoice.
- Fields:
  - `id`
  - `invoice_id` (FK -> `Invoice`)
  - `payment_date`
  - `amount`
  - `method` (optional)
  - `reference` (optional free text)
  - `notes` (optional)
  - `created_by_user_id`
  - `created_at`, `updated_at`

Computed:
- `invoice_outstanding_balance = invoice_total - sum(payment.amount)`

Audit requirement:
- Admin can add payments retroactively.
- Editing payments is allowed or not is TBD; if disallowed, treat payments as append-only for audit safety.

### 6.3 `InvoiceDocument`
Stores generated PDF artifacts for invoices and receipts.
- Fields (suggested):
  - `id`
  - `invoice_id` (FK -> `Invoice`)
  - `document_type` (enum: `invoice_pdf`, `receipt_pdf`)
  - `file_storage_path` (or blob reference)
  - `generated_at`
  - `generated_by_user_id` (nullable for automated generation)
  - `document_language` (string/enum; default `el`)

### 6.4 `NotificationDispatch`
Tracks invoice/receipt email dispatch attempts for audit and retries.
- Fields (suggested):
  - `id`
  - `invoice_id` (FK -> `Invoice`)
  - `notification_type` (enum: `monthly_invoice_email`, `payment_receipt_email`)
  - `recipient_email`
  - `language` (string/enum; default `el`)
  - `status` (enum: `queued`, `sent`, `failed`)
  - `error_message` (nullable)
  - `sent_at` (nullable)
  - `created_at`

## 7. Relationships summary (mental model)

- `Building` has many `Apartment`.
- `Apartment` has many `ApartmentUser` links.
- Exactly one `DesignatedVoter` points to a `User` linked to the `Apartment`.
- `AdministratorTerm` grants elevated access to an apartment/user for a year.
- `VoteSession` has many `Vote` rows (one per apartment).
- `HeatingMeasurementInput` and `HeatedWaterMeasurementInput` provide computed usage values per apartment/month.
- `ExpenseItem` has computed `AllocatedExpense` per apartment/month.
- `Invoice` aggregates computed charges; `Payment` reduces outstanding balance.
- `Invoice` has generated `InvoiceDocument` PDFs and `NotificationDispatch` email logs.

## 8. Future-proofing notes (optional)
- When you provide heated water distribution details, we can align `HeatedWaterMeasurementInput.inputs_json` with the required inputs and test the allocation deterministically.
- Keep all templated output (UI labels, email templates, PDF templates) keyed by locale from day one, with `el` as default and `en` reserved for later rollout.

