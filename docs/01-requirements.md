# Block-of-Flats Admin: Requirements

## 1. Purpose
This system manages monthly accounting for a single block of flats. It allows tenants and owners to:
1) view allocated expenses and month-by-month invoices
2) view invoice payment/settlement status
3) participate in voting (with one vote per apartment)

An administrator (elected yearly) has elevated access to enter the accounting data and manage voting sessions.
There is also a `superadmin` who invites users and configures apartment assignments.

## 2. Definitions
- **Building**: the single block of flats being administered (initially one building only).
- **Apartment (Flat)**: a specific unit (e.g., `A-12`, `Flat 3`), belonging to the building.
  - includes `owner_name` for display and reporting.
  - display label format: `unit_code-owner_name` (example: `A1-IGNATIOU`).
- **User**: a person who can log in.
- **ApartmentUser link**: association between a `User` and an `Apartment`, created by `superadmin`. A user may be linked to multiple apartments.
- **Ownership**: for each apartment, owners have an ownership share in permille (0..1000). Common expenses are allocated proportionally to ownership.
- **Designated voter (per apartment)**: exactly one linked user per apartment is allowed to cast that apartment’s vote for any vote session.
- **Administrator (elected yearly)**: the designated voter of the elected apartment receives elevated access for that year’s term.
- **Accounting period (monthly)**: each month has an accounting bucket (e.g., `2026-03`) to which measurements/expenses are assigned.
- **Invoice**: per-apartment, per-month bill computed from allocated components.

## 2.1 Language policy
- Primary language is **Greek** for all user-facing content in MVP.
- Scope includes:
  - frontend UI labels/messages
  - invoice/receipt PDFs
  - email subjects and bodies
  - exported printable/accounting user-facing text
- The system must be designed i18n-ready so **English** can be enabled later as a secondary language without schema-breaking changes.

## 3. Roles and permissions
### 3.1 Roles
- **Superadmin**
  - Invites users
  - Links users to apartments
  - Sets the designated voter for each apartment
  - Can manage configuration and maintenance
- **Administrator (elected yearly)**
  - Inputs measurements needed for allocations (heating and heated water)
  - Records expense items and payments
  - Manages voting sessions (including administrative election and motions)
  - Can trigger invoice generation/regeneration
- **Tenant/Owner (non-admin)**
  - Can view invoices and month stats for apartments they are linked to
  - Can vote only if they are the designated voter for that apartment
  - Cannot edit accounting data

### 3.2 Authorization rules (high level)
- All accounting objects (measurements, expenses, payments, invoices) are apartment-scoped.
- Regular users can only access data for apartments they are linked to.
- Voting is allowed only by the designated voter for the target apartment.

## 4. User stories and acceptance criteria

### 4.1 Superadmin onboarding and configuration
**US-1: Invite users and assign them to apartments**
- As `superadmin`, I can invite a user and link them to one or more apartments.
- Acceptance criteria:
  - A user cannot access an apartment’s invoices/stats unless they have an ApartmentUser link.
  - Superadmin can create/update apartment-user links and set each apartment’s ownership permille share used for common expense allocation.

**US-2: Set designated voter per apartment**
- As `superadmin`, I can select exactly one linked user as the designated voter for each apartment.
- Acceptance criteria:
  - Each apartment has exactly one designated voter at any time.
  - If the designated voter changes, that change affects *future* vote submissions (votes already cast remain audit-logged).

### 4.2 Measurements and allocations (admin)
**US-3: Enter individual heating usage inputs**
- As `administrator`, I can enter heating usage inputs for each apartment for a given month.
- Acceptance criteria:
  - Admin can add/edit heating inputs for any month (including past months) through a month-based bulk form.
  - In the monthly entry form, each apartment row contains:
    - previous heating reading (read-only)
    - current heating reading (editable)
    - computed units (read-only)
  - `units_counted` is computed as:
    - `current_heating_reading - previous_heating_reading`
  - The entry includes declared `billing_period_start` and `billing_period_end` for the month.
  - The system computes per-apartment radiator-heating amount using:
    - `((fi * ei) + (UnitsCounted / SumOfUnitsCounted) * (1 - Sum(fi * ei))) * gas_radiator_amount`
  - `ei`/`fi` are maintained as apartment master data (superadmin-maintained), then snapshotted into monthly measurement records; admin does not re-enter them each month.
  - Billing-period aggregates are derived from all apartments in that period.
  - Edits to heating inputs cause invoice recalculation for affected months (see US-10).

**US-4: Enter heated water usage inputs**
- As `administrator`, I can enter heated water usage inputs for each apartment for a given month.
- Acceptance criteria:
  - Admin can add/edit heated water inputs for any month through the same month-based bulk form used for heating.
  - In each apartment row:
    - previous heated-water reading (read-only)
    - current heated-water reading (editable)
    - computed units (read-only)
  - Heated-water units/volume used for allocation is computed as:
    - `current_heated_water_reading - previous_heated_water_reading`
  - The inputs include the declared `billing_period` for the month entry.
  - The system computes and stores per-apartment heating-water volume consumed, which is used to:
    - allocate the heated-water portion of the gas bill, and
    - split the (separate) water consumption bill.
  - Edits trigger invoice recalculation for affected months (see US-10).

**US-4b: Monthly measurement history browsing**
- As `administrator`, I can browse a list of months with measurement coverage and open each month to inspect apartment rows.
- Acceptance criteria:
  - The measurements screen shows one row per month with counts for heating/water entries.
  - Opening a month shows apartment-level previous/current/unit values for both commodities.
  - For new entry, default month is the next available month after the latest stored month.

### 4.3 Expenses (admin)
**US-5: Record common expense items**
- As `administrator`, I can record building expense items (including “gas heating bill” and “water consumption bill”) with an expense date and amount.
- Acceptance criteria:
  - Each expense item belongs to exactly one accounting month bucket based on its date.
  - Some months may contain no expense items for a given commodity (e.g., no gas bill); in that case, the corresponding invoice component is `0`, while measurements are still stored.
  - Gas heating bill handling:
    - the gas bill is a single entity that is split between radiator heating and heated-water energy using energy percentages derived from the declared measurement billing period.
    - the radiator portion is allocated by per-apartment radiator-heating energy usage.
    - the heated-water portion is allocated by per-apartment heating-water volume consumed.
  - Water consumption bill handling:
    - the water consumption bill is allocated by the same per-apartment heating-water volume shares.
  - Common expenses allocation (gardener, common power, garden water, cleaning, elevator service, plus non-recurring incidents) remains proportional to apartment ownership permille.
  - The system supports both:
    - recurring categories (for your own organization) and
    - non-recurring categories (damages, annual servicing) as “one-off items”

**US-6: Record non-recurring/incident expenses**
- As `administrator`, I can record non-recurring expenses (e.g., damages, annual servicing).
- Acceptance criteria:
  - Non-recurring expense items are allocated to apartments using the configured allocation rule (default: ownership-based, unless you later specify a different method).
  - Retroactive changes (editing past expenses) trigger invoice recalculation (US-10).

### 4.4 Invoice generation and settlement (admin + tenants/owners)
**US-7: Generate invoices**
- As `administrator`, I can generate (or regenerate) invoices for a month.
- Acceptance criteria:
  - For each linked apartment, an invoice exists for the selected month.
  - Invoice totals are deterministic from stored measurements, expenses, and allocation rules.
  - The UI can show invoice component breakdown (at least: radiator heating, heated water, water consumption, and common/non-recurring expenses categories).
  - The system can generate a per-apartment PDF invoice for each invoice.

**US-8: View invoices and balances (tenant/owner)**
- As a tenant/owner, I can view my apartments’ invoices for each month and see payment status.
- Acceptance criteria:
  - A user can only view invoices for apartments they are linked to.
  - Invoice totals and payment status reflect the latest recorded payments for that month.

**US-9: Record payments against an invoice (admin)**
- As `administrator`, I can record payments for a given apartment and month.
- Acceptance criteria:
  - Each payment reduces the invoice outstanding balance for that apartment+month.
  - Payments include at least: amount, payment date, optional notes/reference.
  - Admin can add payments retroactively and invoices reflect the new balance.
  - When an invoice is marked as fully paid, the system sends an email receipt with a per-apartment PDF receipt attachment to linked tenant/owner recipients.

**US-10: Recalculation and edit behavior**
- As system, when inputs change for a month (measurements/expenses/payments), it maintains consistency between allocations and displayed invoice totals.
- Acceptance criteria:
  - When measurements or expenses change for a month, invoice computed totals are recalculated.
  - When invoices are recalculated, payment totals remain the source of truth for settlement (payments are not overwritten).
  - The system keeps an audit trail of who changed what and when (at minimum for: measurements, expenses, payments, and votes).

### 4.5 Voting (designated voter per apartment)
**US-11: Participate in voting sessions**
- As a tenant/owner designated voter, I can cast one vote per apartment for active voting sessions.
- Acceptance criteria:
  - A designated voter can submit exactly one vote per apartment per voting session.
  - The system rejects attempts to cast a second vote for the same apartment+session.
  - A user who is not the designated voter cannot cast a vote for that apartment.

**US-12: Cast/change vote until deadline**
- As the designated voter, I can change my vote while the session is active, until the deadline.
- Acceptance criteria:
  - Vote edits are allowed up until `end_at` of the session.
  - After `end_at`, vote submission and modifications are rejected.

**US-13: Administrator election (yearly)**
- As administrator election logic, the designated voters cast votes per apartment for the administrator election.
- Acceptance criteria:
  - Election sessions are yearly.
  - Winner selection uses a majority rule (default: “highest number of votes wins”; ties require a tie-break rule which will be documented as `TBD` until you choose it).
  - The designated voter of the winning apartment becomes the `administrator` for the election term.
  - If the designated voter changes before term start, term assignment policy is `TBD` (default: winner’s designated voter at election close).

**US-14: Arbitrary motions**
- As `administrator` (or `superadmin`), I can create and run arbitrary motions.
- Acceptance criteria:
  - Motions have start/end timestamps, title, and description.
  - Each motion has exactly one vote per apartment, cast by the designated voter.
  - Results are visible after the motion ends.

### 4.6 Notifications and documents
**US-15: Monthly automated invoice emailing**
- As `administrator`, I can trigger monthly invoice distribution and the system sends invoice emails automatically.
- Acceptance criteria:
  - For a selected month, the system sends an invoice email per apartment to configured recipients.
  - Each email includes totals and has the apartment PDF invoice attached.
  - Email and attached PDF content are Greek in MVP.
  - Delivery status is tracked per apartment email attempt (e.g., queued/sent/failed).

**US-16: Paid receipt emailing**
- As `administrator`, when I mark an invoice as paid, tenants/owners receive a receipt email.
- Acceptance criteria:
  - A PDF receipt is generated for that apartment+month invoice.
  - The receipt email is sent automatically to configured apartment recipients.
  - Email and attached PDF content are Greek in MVP.
  - Duplicate receipt sends are prevented unless explicitly re-triggered by admin.

## 5. Data model constraints (business rules)
- One designated voter per apartment.
- One vote per apartment per voting session.
- Each apartment has an ownership permille share; owners are linked to apartments; common expenses are allocated proportionally.
- Invoice totals are derived from:
  - per-apartment radiator-heating allocation inputs (from thermal-factor formula)
  - per-apartment heating-water volume allocation inputs
  - the declared billing period on measurements (to match gas and water bills)
  - expense items allocated by month and category
  - payment totals are subtracted from invoice totals to compute outstanding balance.

## 6. Open items / TBD placeholders
- The heated water distribution algorithm you plan to explain later.
- Treatment of non-recurring categories if you want a different allocation method than ownership permille.
- Vote options set (e.g., `yes/no/abstain`) and tie-break rule for administrator election.
- Rounding policy for currency and allocation components (default: currency minor units with banker's rounding rules documented later).

