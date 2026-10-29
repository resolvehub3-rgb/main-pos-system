# Commerce database (prepared, not executed)

This folder holds **review-only SQL** for the future, dedicated SamTill
**commerce** Supabase project.

## Absolute rules

1. **Nothing in this folder has been executed.** The SQL is a proposal for
   review; no database anywhere has run it.
2. **Never run it against the SamTill POS Supabase project** or any database
   holding POS, sales, stock, receipt, or customer-display data. Commerce and
   POS stay in separate Supabase projects with separate credentials.
3. Execution requires the owner's explicit approval, after the dedicated
   commerce project has been created.

## Files

| File                                | Purpose                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| `migrations/0001_commerce_init.sql` | Full schema: accounts, plans, orders, subscriptions, entitlements, webhook dedup, audit logs, deny-by-default RLS. |
| `seeds/0001_approved_plans.sql`     | The three approved one-time plan rows (starter / business / professional) that the website's package ids must match. |

## Run order (once, on the dedicated commerce project)

1. `migrations/0001_commerce_init.sql`
2. `seeds/0001_approved_plans.sql`
3. verify: RLS denies the anon key on every table except the intended
   `profiles` self-select.

See `../docs/02-commerce-architecture.md` for the schema rationale, endpoint
status matrix, retention rules and the security checklist. The approved
one-time pricing model and its rationale are recorded in
`../docs/01-commercial-decisions.md`.
