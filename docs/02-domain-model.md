# Block-of-Flats Admin: Domain Model

This describes the models in `backend/flats/models.py` and `backend/accounts/models.py`. Allocations are computed when invoices are generated. They are not stored as their own table.

## 1. Design goals
- Apartment-scoped reads for regular users.
- Invoice totals can be recomputed from stored readings, factors, and expenses.
- One vote per apartment per session, enforced by a unique constraint. A cast vote is final.
- Writes record `created_by_user` where the model has that field.

## 2. People

### 2.1 `User` (`accounts.User`, Django `AbstractUser`)
- `username`, `email`, `first_name`, `last_name`, `is_active`
- `role`: `superadmin` | `administrator` | `user`
- `preferred_language` (default `el`)
- `must_change_password` (set by the invite flow)

There is no `AdministratorTerm`. The administrator is whoever has `role=administrator`.

### 2.2 `Building`
- `name`
- `fund_balance` (decimal, default 0). The dashboard reserve. `fund_increase` expenses adjust it. Admins can also patch it
- `created_at`, `updated_at`

### 2.3 `Apartment`
- `building` (FK)
- `unit_code` (unique with building)
- `owner_name`
- `apartment_label` (property): `unit_code` plus uppercased owner name, or `unit_code` alone
- `ownership_permille` (decimal)
- `heating_e_factor`, `heating_f_factor` (nullable master data, snapshotted onto heating rows)
- `created_at`, `updated_at`

### 2.4 `ApartmentUser`
- `apartment`, `user` (unique together)
- `is_tenant` (default true), `is_owner` (default false)

### 2.5 `DesignatedVoter`
- `apartment` (one-to-one)
- `voter_user`
- `effective_from` (optional)
- The voter must already be an `ApartmentUser` for that apartment

## 3. Voting

### 3.1 `VoteSession`
- `building`
- `session_type`: `administrator_election` | `motion`
- `title`, `description`
- `vote_options_json` (list). Empty means yes / no / abstain
- `start_at`, `end_at`
- `status`: `draft` | `active` | `closed`
- `created_by_user`

### 3.2 `Vote`
- `vote_session`, `apartment` (unique together)
- `voter_user`
- `vote_value` (string, must match the session options)
- `submitted_at`, `updated_at`

A second post for the same apartment and session returns 409. Results are counts from stored votes. They do not change `User.role`.

## 4. Measurements

Identity is `measurement_date`, not a separate month row. The accounting month is `YYYY-MM` of that date, or of `expense_date` for expenses.

### 4.1 `HeatingMeasurementInput`
- `apartment`, `measurement_date` (unique together)
- `e_factor`, `f_factor` (copied from the apartment)
- `current_reading`
- `units_counted` = current reading minus the previous reading (0 if none)
- `computed_radiator_heating_energy`
- `created_by_user`

### 4.2 `HeatedWaterMeasurementInput`
- `apartment`, `measurement_date` (unique together)
- `current_reading`
- `computed_heating_water_volume` (reading delta)
- `inputs_json` (unused by the allocator; volume comes from the reading delta)
- `created_by_user`

### 4.3 `BuildingMeasurementInput`
- `building`, `measurement_date` (unique together)
- `hot_water_heating_current_reading`
- `hot_water_heating_units` (boiler delta used to split the gas bill)
- `created_by_user`

Negative reading deltas are rejected. A date is locked for edits once invoices exist for that calendar month.

## 5. Expenses

### 5.1 `ExpenseItem`
- `building`
- `expense_category` (see below)
- `expense_date`
- `month` (`YYYY-MM`, set from `expense_date` on save)
- `affected_period_start`, `affected_period_end` (used for gas and hot-water bills)
- `amount`, `description`
- `is_paid` (default true). Whether the building has paid the supplier. Unpaid expenses stay in ταμείο and appear on the dashboard as ανεξόφλητα έξοδα. `fund_increase` is always paid.
- `created_by_user`

Categories:
- Common (ownership permille → `common_recurring_total`): `gardener`, `common_power_usage`, `common_water_usage`, `cleaning`, `elevator_service`
- Non-recurring (ownership permille → `common_non_recurring_total`): `damages`, `annual_servicing`, `other`
- Owners (ownership permille → `owners_only_total`): `owners_only`, `fund_increase`
- Commodity: `gas_heating_bill`, `water_hw_consumption_bill`
- Legacy, rejected on generate: `gas_hw_consumption_bill`

`fund_increase` also adds its amount to `Building.fund_balance` (reversed on edit or delete).

There is no `AllocatedExpense` table. Shares are computed in `_calculate_invoice_rows`.

## 6. Invoices and money

### 6.1 `Invoice`
One row per apartment and `month` (`YYYY-MM`).
- `heating_radiators_total`
- `heated_water_energy_total`
- `water_consumption_total`
- `common_recurring_total`
- `common_non_recurring_total`
- `owners_only_total`
- `custom_adjustment`, `custom_adjustment_note`
- `invoice_total` = computed components + `custom_adjustment`
- `paid_total`, `outstanding_balance`
- `status`: `draft` | `issued` | `paid`
- `issued_at`, `updated_at`

### 6.2 `PaymentRecord`
- `invoice`, `apartment`
- `amount`, `payment_date`
- `method`: `cash` | `bank_transfer` | `card` | `other`
- `reference`, `notes`
- `created_by_user`
- Overpayment is rejected. Delete recalculates the invoice. Payments are not append-only

### 6.3 `InvoiceDocument`
- `invoice`, optional `payment`
- `document_type`: `invoice` | `receipt`
- `file_name`, `mime_type`, `content` (`BinaryField`)
- PDFs are not public files. Download goes through the API

### 6.4 `NotificationDispatch`
- `invoice`, optional `payment`
- `notification_type`: `receipt_paid` | `invoice_monthly`
- `recipient_email`
- `status`: `queued` | `sent` | `failed` | `skipped`
- `error_message`, `sent_at`, `created_at`

## 7. Relationships
- `Building` has apartments, expenses, vote sessions, boiler readings, and `fund_balance`
- `Apartment` has memberships, one designated voter, measurements, invoices, and votes
- `Invoice` has payments, documents, and notification rows
- Invoice generation reads measurements and expenses. It does not persist per-expense allocation rows
