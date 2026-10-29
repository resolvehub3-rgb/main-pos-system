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
| `migrations/0002_account_approval.sql` | Registration → waiting-for-approval → super-admin approval → notification email → dashboard workflow: `approval_status` on profiles, `admin_users`, `is_admin()`, approve/reject/request-setup RPCs, a pg_net → Resend approval-email trigger, and realtime on `profiles`. |
| `seeds/0001_approved_plans.sql`     | The three approved one-time plan rows (starter / business / professional) that the website's package ids must match. |

## Run order (once, on the dedicated commerce project)

1. `migrations/0001_commerce_init.sql`
2. `migrations/0002_account_approval.sql`
3. `seeds/0001_approved_plans.sql`
4. verify: RLS denies the anon key on every table except the intended
   `profiles` self-select.

## After running (bootstrap)

1. **Promote the first admin.** Register the owner account on the landing site,
   verify its email, then (as the service role / in the SQL editor):

   ```sql
   insert into public.admin_users (user_id) values ('<owner auth.users uuid>');
   ```

   That account can then approve/reject others at `#/admin`.

2. **Configure the approval email (optional).** Without it, approval still
   works — the trigger just skips sending. With it, approving an account emails
   the customer via Resend:

   ```sql
   insert into public.app_settings (key, value) values
     ('email_provider_api_key', 're_xxxxxxxx'),
     ('email_from',             'SamTill <no-reply@yourdomain.example>'),
     ('site_url',               'https://your-landing-site.example');
   ```

3. **Turn the site on.** Set the landing site's
   `VITE_COMMERCE_SUPABASE_URL` / `VITE_COMMERCE_SUPABASE_ANON_KEY`
   (`COMMERCE.accountEnabled` is already `true`). Registration then works end to
   end and in realtime: register → verify email → sign in → "waiting for
   approval" → admin approves (email sent) → the dashboard unlocks live.

See `../docs/02-commerce-architecture.md` for the schema rationale, endpoint
status matrix, retention rules and the security checklist. The approved
one-time pricing model and its rationale are recorded in
`../docs/01-commercial-decisions.md`.
