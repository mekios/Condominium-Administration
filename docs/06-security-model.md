# Block-of-Flats Admin: Security Model

## 1. Threats this model must prevent
- Cross-apartment data leakage:
  - tenants/owners must not be able to read or infer invoices, payments, measurements, or allocations for apartments they are not linked to.
- Vote tampering and double-vote attempts:
  - only the designated voter for an apartment can vote for that apartment.
  - there must be exactly one vote per apartment per session.
  - votes must be changeable only until the session deadline.
- Unauthorized accounting writes:
  - only `administrator`/`superadmin` can enter measurements, expenses, and payments.
- Cache poisoning / incorrect caching:
  - Redis cached data must not be shared across apartments/users incorrectly.
- Retroactive edits consistency:
  - recalculation must not allow a user to “edit history” outside allowed permissions.

## 2. Authorization boundaries (the core rule)
Every sensitive resource is associated with an `Apartment`.
Authorization rules must always include:
- “Is this user authorized for this apartment?”

Authorization inputs:
- `superadmin`: authorized for all apartments
- `administrator`: authorized for all accounting operations (per business policy), even though votes remain designated-voter scoped
- regular users: authorized only for apartments where they have an `ApartmentUser` link
- voting:
  - designated-voter enforcement uses `DesignatedVoter` record for the target apartment

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
  - current time is <= `vote_session.end_at`

### 4.2 One vote per apartment per session
Enforce at both layers:
- Database constraint:
  - `unique(vote_session_id, apartment_id)`
- Application logic:
  - upsert behavior:
    - create if no vote exists yet
    - update existing vote if it exists and deadline not passed

### 4.3 Deadline enforcement (mandatory)
- Voting APIs must reject modifications after `end_at`.
- UI should also hide/edit controls based on `end_at`, but server remains source of truth.

## 5. Preventing cross-apartment leakage
Hard rules for data reads:
- Regular users:
  - may only call invoice/stats endpoints that scope by `ApartmentUser` links
- Even if a regular user guesses an `invoiceId` or `sessionId`:
  - detail endpoints must validate apartment ownership for that object

Implementation requirement:
- Never build responses purely from frontend-provided apartment IDs.
- Always compute accessible apartment IDs from authenticated user server-side.

## 6. Measurements, expenses, and payments writes
Only allow:
- `administrator` and `superadmin` to create/update/delete measurement inputs, expenses, and payment entries.

Further policy (TBD):
- For administrator term scoping:
  - optionally restrict to admin term year for writes
  - or allow admin to write for any month as long as term is active

Auditing requirement:
- log each write with:
  - actor user id
  - affected apartment_id(s)
  - accounting month
  - timestamp

## 7. Invoices regeneration and consistency
Invoice totals are derived from allocations:
- If measurements or expenses are edited for a month:
  - invoices for that month should be regenerated (immediately or lazily)

Security implication:
- regular users must never be able to trigger invoice regeneration.
- admin regeneration must not bypass access control for apartments (admins can regenerate all; regular users cannot call that endpoint).

## 8. Redis caching safety
Caching must incorporate apartment/month keys.
Cache invalidation:
- When heating/heated-water inputs change:
  - invalidate cached totals for the affected apartment(s) and month
- When an expense item changes:
  - invalidate cached totals for all apartments in the building for the affected month (ownership-permille based allocation touches all apartments)
- When payments change:
  - invalidate invoice balance caches for the affected invoice/apartment+month

Never cache:
- responses containing multiple apartment results keyed only by month if user scoping differs by apartment.

## 9. Security acceptance tests (recommended)
Add tests to validate:
- A regular user cannot retrieve an invoice for a non-linked apartment (403 or 404).
- A non-designated user cannot submit a vote for an apartment they are linked to.
- Submitting a second vote returns an error due to unique constraint.
- Submitting after `end_at` is rejected.
- Changing delegated voters impacts future voting submissions.
- Cache keys vary by apartment/month (no cross-apartment response mixing).

## 10. Remaining open decisions
- Vote options set and tie-break rules for administrator election.
- Rounding policy for allocation and invoice component sums (cent rounding and remainder distribution).
- Whether payment edits are append-only or mutable (auditing impact).

## 11. Email and PDF security notes
- Invoice and receipt PDFs contain personal/accounting data and must be access-controlled in storage.
- Email sends must be audited per recipient (status + timestamp + error on failure).
- Only administrator/superadmin can trigger bulk monthly invoice emails or paid-receipt re-sends.
- Avoid exposing direct public PDF URLs; prefer time-limited signed links or attachment generation on send.
- Locale consistency: ensure the locale used for each generated document/email is recorded (`el` for MVP), to avoid mixed-language legal/accounting artifacts per dispatch.

