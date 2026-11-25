# Block-of-Flats Admin: Accounting Rules

Rules below match `backend/flats/views.py` (`_calculate_invoice_rows`, `_allocate_amount_by_weights`) and the dashboard balance in `frontend/src/app/features/dashboard.component.ts`.

## 1. Accounting period
- An invoice month is `YYYY-MM`.
- An expense’s month is `expense_date` formatted as `YYYY-MM`.
- Heating, hot water, and boiler rows are stored by `measurement_date`. Invoice generation pulls the readings that apply to the expense’s affected period, or to that month when the period is empty.
- Regenerating a month (`POST /api/invoices/generate/`) overwrites component totals. Existing payments stay and outstanding balance is recomputed. A `custom_adjustment` already stored on the invoice is kept unless the request sends a new `adjustments` list.

## 2. Reading deltas
For each apartment, the admin enters the current heating reading and the current hot-water reading. The boiler row is the building hot-water heating reading.

- `units_counted = current_heating_reading − previous_heating_reading`
- `computed_heating_water_volume = current_hot_water_reading − previous_hot_water_reading`
- `hot_water_heating_units = current_boiler_reading − previous_boiler_reading`

Negative deltas are rejected. If there is no previous reading, the previous value is 0. `e_factor` and `f_factor` are copied from the apartment. They are not typed on the monthly form.

Once any invoice exists for that calendar month, the measurement date is locked.

## 3. Money rounding
Amounts are quantized to 0.01 with half-up (`q2`).

Shared amounts (ownership or volume) are split by weight, each share quantized to cents, then the cent remainder is walked across apartments so the shares sum to the expense amount.

## 4. Gas bill
One expense category: `gas_heating_bill` («Φυσικό αέριο (συνολικό)»).

`gas_hw_consumption_bill` is legacy. Invoice generation fails if that category is present, including when it is combined with `gas_heating_bill`.

For the billing period:
- `sum_heating_units` = sum of apartment `units_counted`
- `building_hw_units` = boiler `hot_water_heating_units`
- `total_energy = sum_heating_units + building_hw_units`
- `gas_radiator_amount = gas_total × sum_heating_units / total_energy`
- `gas_hw_amount = gas_total × building_hw_units / total_energy`

If `total_energy` is 0, generation is blocked. If there is no gas expense, both heating components are 0.

Radiator share for apartment `a` (applied to `gas_radiator_amount`):

`((f_a × e_a) + (units_counted_a / sum_units_counted) × (1 − Σ(f_i × e_i))) × gas_radiator_amount`

`sum(f_i × e_i)` must be between 0 and 1.

Hot-water gas share:

`heated_water_energy_amount(a) = gas_hw_amount × (V_a / Σ V)`

`V_a` is `computed_heating_water_volume`.

## 5. Hot-water consumption bill
Category `water_hw_consumption_bill` («Κατανάλωση ζεστού νερού»).

`water_consumption_amount(a) = bill × (V_a / Σ V)`

If the bill is missing, the component is 0. Garden water is not this bill. Garden water is `common_water_usage` and follows ownership permille.

## 6. Ownership allocation
`p_a = ownership_permille(a) / 1000`, then the cent-remainder rule in section 3.

| Bucket | Categories |
|---|---|
| `common_recurring_total` | `gardener`, `common_power_usage`, `common_water_usage`, `cleaning`, `elevator_service` |
| `common_non_recurring_total` | `damages`, `annual_servicing`, `other` |
| `owners_only_total` | `owners_only`, `fund_increase` |

`owners_only` is the owner line (not passed on to tenants). `fund_increase` uses the same invoice line and also adds `amount` to `Building.fund_balance`. Editing or deleting that expense reverses the previous fund delta.

## 7. Invoice total
For apartment `a` and month `m`:

`computed = heating_radiators_total + heated_water_energy_total + water_consumption_total + common_recurring_total + common_non_recurring_total + owners_only_total`

`invoice_total = computed + custom_adjustment`

`custom_adjustment` is an optional per-apartment amount with `custom_adjustment_note`, sent as `adjustments` on generate. It is not an expense category.

`outstanding_balance = invoice_total − paid_total`

Status becomes `paid` when outstanding is 0 and some payment exists. Otherwise an issued invoice stays `issued`. Overpayment is rejected.

## 8. Building reserve on the dashboard
`openingBalance` is `Building.fund_balance`.

`unpaidTotal` (Ανεξόφλητα) is the sum of `outstanding_balance` for invoices with a positive balance (building-wide for admins, `building_scope=1` for residents).

`unbilledExpensesTotal` (Τρέχοντα έξοδα) is the sum of non-`fund_increase` expenses whose month has no invoice in status `issued` or `paid`, plus **all** `fund_increase` amounts. Reserve top-ups raise Αποθεματικό and this line together, so ταμείο never includes `fund_increase`. Paid and unpaid supplier expenses are both included in the unbilled term.

`unpaidExpensesTotal` (Ανεξόφλητα έξοδα) is the sum of expenses with `is_paid=false` (excluding `fund_increase`), whether or not that month is already billed.

`remaining = openingBalance − unpaidTotal − unbilledExpensesTotal + unpaidExpensesTotal`

Unpaid supplier amounts appear in τρέχοντα when still unbilled, and are added back via Ανεξόφλητα έξοδα so ταμείο is unchanged until the expense is marked paid. Issued months are not subtracted again as τρέχοντα; their apartment unpaid part stays in `unpaidTotal`, offset by `+ unpaidExpensesTotal` while the supplier is unpaid.

## 9. Payments and recall
- A payment does not change computed component totals.
- Deleting a payment recalculates `paid_total`, outstanding balance, and status, and removes that payment’s receipt documents.
- `POST /api/invoices/recall-month/` with `{ "month", "confirm": true }` deletes every invoice for the month and cascades payments and stored PDFs.

## 10. Validation used at generation
- At least one apartment must exist.
- `0 ≤ Σ(f_i × e_i) ≤ 1` when the radiator formula runs.
- `sum_units_counted > 0` when a variable radiator share is required.
- Missing apartment measurement rows allocate 0 for that apartment.
- Missing gas or hot-water bills produce 0 for those components.
- Apartment lists are ordered by `unit_code`.
