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
| `migrations/0001_commerce_init.sql` | Full schema: accounts, plans, orders, subscriptions, entitlements, installer releases, download audit, webhook dedup, audit logs, deny-by-default RLS, private `installers` bucket. |

See `../docs/02-commerce-architecture.md` for the schema rationale, endpoint
status matrix, retention rules and the security checklist, and
`../docs/01-commercial-decisions.md` for why no prices are seeded.
