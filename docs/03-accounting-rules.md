# Block-of-Flats Admin: Accounting Rules

## 1. Accounting period (monthly)
- Each month is an accounting bucket identified by `YYYY-MM` (e.g., `2026-03`).
- Inputs are assigned to a month by their date:
  - `HeatingMeasurementInput` month: explicit monthly entry (`YYYY-MM`) from admin form.
  - `HeatedWaterMeasurementInput` month: explicit monthly entry (`YYYY-MM`) from admin form.
  - `ExpenseItem` month: derived from `expense_date`.
  - `Invoice` month: one invoice per apartment per accounting month.

Retroactivity:
- The system supports unplanned and retroactive entries.
- If an admin edits measurements or expenses for a past month, the system recalculates allocated usage and updates invoice computed totals accordingly.

## 2. Determinism and recalculation
For any given accounting month:
- Heating totals come from stored heating measurement inputs (plus your thermal-factor formula).
- Heated water totals come from stored heated-water measurement inputs (plus your distribution algorithm).
- Common/non-recurring expense allocations come from stored expense items and apartment ownership permille.
- Invoice totals are computed as:
  - `invoice_total = radiator_heating_amount + heated_water_energy_amount + water_consumption_amount + allocated_expenses_total`
  - Payment settlement is computed independently:
    - `outstanding = invoice_total - sum(payments.amount)`

Audit:
- The system should record:
  - which user edited which inputs (`created_by_user_id`)
  - when invoices were generated/regenerated (`issued_at`, `computed_at`)
  - a recomputation version (`allocation_version`) so you can reproduce the invoice later.

## 2.1 Reading-based monthly units
For each apartment and month:
- Admin enters **current readings** for:
  - heating meter
  - heated-water meter
- System derives units by difference from previous month:
  - `heating_units_counted = heating_current_reading(m) - heating_current_reading(m-1)`
  - `heated_water_volume = heated_water_current_reading(m) - heated_water_current_reading(m-1)`
- Validation:
  - negative deltas are rejected as invalid input
  - if no previous reading exists, previous value defaults to `0` (bootstrap month)

## 3. Gas bill split: radiators vs heating water
Inputs:
- For each apartment `a`, system uses:
  - `e_a` (factor `ei`)
  - `f_a` (factor `fi`)
  - `units_counted_a` (`UnitsCounted`, derived from reading delta)
- For the building boiler (central calorimeter for heating water), stored in `BuildingMeasurementInput`:
  - `building_hw_units` = delta of `hot_water_heating_current_reading` over the billing period (same boundary logic as apartments when `affected_period_start/end` are set)
- For the billing period:
  - `sum_heating_units = sum(units_counted_a for all apartments)`
  - `total_energy = sum_heating_units + building_hw_units`
  - `gas_total` = single expense in category `gas_heating_bill` («Φυσικό αέριο (συνολικό)») for the month

Split of the single gas bill:
- `gas_radiator_amount = gas_total × sum_heating_units / total_energy`
- `gas_hw_amount = gas_total × building_hw_units / total_energy`

Apartment radiator-heating formula (exact, applied to `gas_radiator_amount`):
- Let:
  - `fixed_component_a = f_a * e_a`
  - `sum_fixed = sum(f_i * e_i for all apartments)`
  - `variable_component_a = (units_counted_a / sum_units_counted) * (1 - sum_fixed)`
- Then:
  - `radiator_share_a = fixed_component_a + variable_component_a`
  - `radiator_heating_amount(a) = radiator_share_a * gas_radiator_amount`

Equivalent compact form (your formula):
- `((f_a * e_a) + (units_counted_a / sum_units_counted) * (1 - sum(f_i * e_i))) * gas_radiator_amount = amount_apartment_must_pay`

Heating-water gas portion allocation:
- `heated_water_energy_amount(a) = gas_hw_amount * (V_apartment / sum(V_apartment))`
- where `V_apartment` is the heating-water volume computed in section 4.

Policy:
- Use **one** gas expense category (`gas_heating_bill`) per billing period; the legacy `gas_hw_consumption_bill` category is deprecated and must not be combined with the combined gas bill for the same period.
- If `total_energy == 0`, invoice generation is blocked.

Implementation guidance (to make this deterministic):
- Store both:
  - the inputs used to compute `radiator_share_a` (`e_a`, `f_a`, `units_counted_a`)
  - the computed result `radiator_heating_amount(a)`
- Store billing-period aggregate snapshots used during calculation:
  - `sum_heating_units`
  - `building_hw_units`
  - `sum_fixed`
  - `gas_radiator_amount`
  - `gas_hw_amount`

Edge case: missing expenses
- If `gas_total` is missing for a month, then both `radiator_heating_amount` and `heated_water_energy_amount` for that month are `0` even though measurements still exist.

## 4. Water types and allocation rules
There are 2 different water expense types:
- Garden water (`common_water_usage`)
  - Allocated by apartment ownership permille (`ownership_permille / 1000`).
- Heater water (`water_consumption_bill`)
  - Allocated by measured heated-water volume (`V_apartment / sum(V_apartment)`).

## 4.1 Heating-water volume allocations (heater water bill)
Inputs:
- For each apartment `a`, admin provides monthly heated-water **current reading**.
- System derives:
  - `V_apartment = heated_water_current_reading(m) - heated_water_current_reading(m-1)`

Implementation guidance:
- Store both:
  - `current_reading`
  - `computed_heating_water_volume` result (`V_apartment`)

Heater water bill splitting:
- Let:
  - `water_consumption_total` = total water-consumption bill amount for the month (may be missing for a given month)
- Then:
  - `water_consumption_amount(a) = water_consumption_total * (V_apartment / sum(V_apartment))`

Edge case: missing expenses
- If `water_consumption_total` is missing for a month, then `water_consumption_amount` is `0` even though `V_apartment` exists from measurements.

## 5. Common expenses allocation (ownership-permille based)
Expense categories (initial list):
- common recurring:
  - `gardener`
  - `common_power_usage`
  - `common_water_usage` (garden water)
  - `cleaning`
  - `elevator_service`
- non-recurring:
  - `damages`
  - `annual_servicing`
- owners only:
  - `owners_only` — Expenses paid only by owners, not tenants (structural damages, core equipment fixes, facade changes, new machinery). Allocated by ownership permille. Shown as separate line on invoice so owners know not to pass to tenants.

Default allocation rule:
1. Compute each apartment’s ownership fraction:
   - For apartment `a`:
     - `p_a = ownership_permille(a) / 1000`
   - You should ensure:
     - `sum(p_a for all apartments) = 1.0` (or very close due to rounding).
2. For each expense item `E` belonging to accounting month `m`:
   - `allocated_amount(a, E) = E.amount * p_a`
3. For each invoice/month/apartment, sum allocations:
   - `allocated_expenses_total(a, m) = sum(allocated_amount(a, E) for E in month m)`

Rounding policy:
- Currency should be stored and computed in minor units (e.g., cents) or with a consistent decimal precision.
- Because `E.amount * p_a` may not be an integer in minor units:
  - choose a deterministic rounding strategy:
    - round each apartment allocation to cents
    - adjust the last apartment allocation by the rounding remainder (to ensure sum equals total expense)
- This rule must be consistent across recalculations.

Default handling of non-recurring:
- Until you specify otherwise, non-recurring categories are allocated using the same ownership-permille rule as common expenses.

## 6. Invoice component breakdown
For each apartment `a` and month `m`, the invoice component totals are:
- `radiator_heating_amount(a, m)` = computed from radiator heating + gas bill split
- `heated_water_energy_amount(a, m)` = computed from gas bill split + heating-water volume shares
- `water_consumption_amount(a, m)` = computed from water consumption bill + heating-water volume shares
- `allocated_expenses_total(a, m)`:
  - common recurring categories total
  - plus non-recurring/incident categories total
  - plus owners-only categories total (separate line: not to be passed to tenants)
- `invoice_total(a, m)`:
  - `invoice_total = radiator_heating_amount + heated_water_energy_amount + water_consumption_amount + allocated_expenses_total`

## 7. Payments and settlement
Payments are appended (or editable, TBD) and invoice outstanding balance is:
- `balance(a, m) = invoice_total(a, m) - sum(payments.amount for invoice(a, m))`

Payment effects:
- Payment entry does not change invoice computed totals.
- If invoice totals are recalculated due to edited inputs, outstanding balance should reflect the new invoice_total minus existing payments.

## 8. Validation rules (required for correctness)
- Ownership validation:
  - if ownership permille values are inconsistent (sum deviates from 1000 permille), the system should:
    - either block invoice generation or
    - generate with warnings and show “ownership normalization” behaviour (TBD).
- Completeness validation:
  - For a given month:
    - admin monthly entry form should contain one row per apartment with both commodities.
    - for missing apartment row values, invoice generation behavior is policy-based:
      - either block generation for that month, or
      - treat missing values as zero snapshot (current implementation: missing rows behave as zero allocation).
  - Separately, missing expense items are allowed:
    - if `gas_heating_bill` is absent, `radiator_heating_amount` and `heated_water_energy_amount` are `0`
    - if `water_consumption_bill` is absent, `water_consumption_amount` is `0`
- Heating formula validation:
  - `sum_units_counted > 0` when calculating variable components
  - each apartment must provide `e_a`, `f_a`, and `units_counted_a` for the billing period
  - `sum_fixed = sum(f_i * e_i)` must satisfy `0 <= sum_fixed <= 1`
  - `radiator_share_a` should be within `[0,1]` and all shares should sum to approximately `1.0` (allow minor rounding tolerance)
- Ordering rule:
  - all apartment lists shown in UI and API responses must be sorted by `unit_code` ascending.

## 9. What you should provide next
- Your explanation for how heated water bills are distributed among apartments.

Once you provide them, we will:
1. finalize heated-water `inputs_json` schema (or replace with explicit fields)
2. finalize deterministic computation steps and add test cases for sample scenarios.

