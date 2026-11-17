# Block-of-Flats Admin: Security Model

## 1. Threats this model must prevent
- Cross-apartment data leakage:
  - tenants/owners must not be able to read or infer invoices, payments, measurements, or allocations for apartments they are not linked to.
- Vote tampering and double-vote attempts:
  - only the designated voter for an apartment can vote for that apartment.
  - the voter must also be an `ApartmentUser` of that apartment, including when the caller is an administrator.
  - there is exactly one vote per apartment per session.
  - a second submission is rejected. Votes are not editable, including before `end_at`.
- Unauthorized accounting writes:
  - only `administrator`/`superadmin` can enter measurements, expenses, and payments.
- Cache poisoning / incorrect caching:
  - The API does not cache responses. Dev Compose still starts Redis, and nothing in Django reads it. Do not add a shared cache keyed only by month.
- Retroactive edits consistency:
  - recalculation must not allow a user to “edit history” outside allowed permissions.

## 2. Authorization boundaries (the core rule)
Every sensitive resource is associated with an `Apartment`.
Authorization rules must always include:
- “Is this user authorized for this apartment?”

Authorization inputs:
- `superadmin`: `User.role`. Authorized for all apartments, including designated-voter assignment
- `administrator`: `User.role`. Authorized for accounting writes and voting-session management. Votes still require designated-voter membership on the target apartment. There is no `AdministratorTerm`
- regular users: authorized only for apartments where they have an `ApartmentUser` link, plus building-scoped invoice reads when `building_scope=1`
- voting:
  - designated-voter enforcement uses the `DesignatedVoter` row for the target apartment
- UI admin mode (`sessionStorage`) does not grant API access

## 3. DRF implementation guidance (conceptual)
Use DRF patterns:
- Filter querysets by accessible apartment IDs in `get_queryset()`.
- Use permission classes to gate write operations by role.
- Add object-level permission checks on detail endpoints and non-list endpoints.

Checklist for each API endpoint:
1. For list endpoints:
   - filter by apartment IDs for regular users
2. For detail endpoints:
   - verify the object’s apartment_id is accessible
3. For write endpoints:
   - verify user role (superadmin/administrator) OR designated voter for votes
4. For calculations and regeneration endpoints:
   - ensure only admins can trigger recomputation

## 4. Vote enforcement rules
### 4.1 Designated voter check (mandatory)
When a vote is submitted for `vote_session_id` and `apartment_id`:
- server must verify:
  - `request.user` is linked to `apartment_id` (ApartmentUser exists)
  - `request.user` equals the designated voter user for `apartment_id`
  - session status is `active`
  - `start_at <= now <= end_at`

### 4.2 One vote per apartment per session
Enforce at both layers:
- Database constraint: `unique(vote_session, apartment)`
- Application logic: if a vote row already exists, return 409 and leave it unchanged

### 4.3 Window enforcement
- Voting APIs reject submission unless status is `active` and `start_at <= now <= end_at`.
- The UI hides the form outside that window. The server remains the source of truth.

## 5. Preventing cross-apartment leakage
Hard rules for data reads:
- Regular users:
  - may only read invoices, payments, and measurements for apartments or buildings they are linked to
- Even if a regular user guesses an `invoiceId` or `sessionId`:
  - detail endpoints must validate apartment ownership for that object

Implementation requirement:
- Never build responses purely from frontend-provided apartment IDs.
- Always compute accessible apartment IDs from authenticated user server-side.

## 6. Measurements, expenses, and payments writes
Only `administrator` and `superadmin` can create, update, or delete measurement inputs, expenses, and payments. They can write any month. A measurement date is rejected once invoices exist for that calendar month.

Actor tracking is `created_by_user` on measurements, expenses, payments, and vote sessions. There is no separate audit-log table. Invoice recall and payment delete are admin-only and covered by `AdminDestructiveOperationsTests`.

## 7. Invoices regeneration and consistency
Invoice totals are derived from allocations:
- If measurements or expenses are edited for a month:
  - invoices for that month should be regenerated (immediately or lazily)

Security implication:
- regular users must never be able to trigger invoice regeneration.
- admin regeneration must not bypass access control for apartments (admins can regenerate all; regular users cannot call that endpoint).

## 8. Caching
No response cache is implemented. If one is added later:
- key by user scope as well as apartment and month
- never cache a multi-apartment payload under a month-only key
- drop keys when measurements, expenses, invoices, or payments for that month change

## 9. Security acceptance tests (recommended)
Add tests to validate:
- A regular user cannot retrieve an invoice for a non-linked apartment (403 or 404).
- A non-designated user cannot submit a vote for an apartment they are linked to.
- A second vote returns 409 and does not replace the stored vote.
- Submission outside the session window is rejected.
- Changing the designated voter affects later submissions only. Stored votes keep `voter_user`.
- An administrator who is not the designated voter of that apartment cannot cast its vote.

## 10. Decisions
- Vote options default to yes / no / abstain. A session may set `vote_options_json`. Election results do not assign a role, so there is no tie-break.
- Allocation uses half-up cents and distributes the remainder. See `docs/03-accounting-rules.md`.
- Payments can be deleted by an admin. They are not append-only. There is no payment edit endpoint.

## 11. Email and PDF security notes
- Invoice and receipt PDFs are bytes on `InvoiceDocument`, not public files.
- Download is `GET /api/invoices/{id}/download-pdf/` and `download-receipt/`, using the same apartment scope as invoice reads.
- Each send is a `NotificationDispatch` row (status, timestamp, error). Duplicate invoice and receipt sends are skipped unless `force=true`.
- Only administrator and superadmin can trigger monthly invoice email or a receipt resend.
- Invite and reset mail go through Brevo SMTP. Documents and emails are Greek.

