# SamTill POS - Deployment & Operations Guide

## 1. Supabase Project Setup
1. Create a project at [supabase.com](https://supabase.com).
2. Go to SQL Editor and run `supabase/migrations/20261020000001_initial_schema.sql`.
3. Optionally run `supabase/seed.sql` for initial subscription tiers.
4. Go to Project Settings -> API to copy `Project URL` and `anon public key`.

## 2. Render Deployment
1. Connect the GitHub repository to [render.com](https://render.com).
2. Use `render.yaml` Blueprint or create two services:
   - Web Service: Root directory `backend/`, command `npm start`, environment variables set.
   - Static Site: Root directory `frontend/`, publish directory `dist`, build command `npm run build`.

## 3. Environment Variables
- `VITE_SUPABASE_URL`: e.g. `https://xyzcompany.supabase.co`
- `VITE_SUPABASE_ANON_KEY`: public anon token
- `VITE_SUPER_ADMIN_EMAIL`: email of the bootstrap Super Admin account
- `VITE_SUPER_ADMIN_PASSWORD`: password of the bootstrap Super Admin account
- `PORT`: `3000`

### Super Admin bootstrap
The app ships with an empty user table and registration only creates `shop_owner`
accounts, so the first Super Admin is provisioned via environment variables:

1. Copy `.env.example` to `.env` and set:
   ```
   VITE_SUPER_ADMIN_EMAIL=<your-email>
   VITE_SUPER_ADMIN_PASSWORD=<a-strong-unique-password>
   ```
   Use your own values — never commit them (`.env` is git-ignored; only
   `.env.example`, which holds placeholders, is tracked).
2. Start (or restart) the dev server / redeploy. Vite reloads `.env` automatically.
3. On every app start `DatabaseService.bootstrapSuperAdmin()` runs:
   - Account missing → created with role `super_admin`, active.
   - Account exists → promoted to `super_admin`, reactivated, password synced to
     the env value so the documented credentials always work.
4. Sign in at the login screen with those credentials → Super Admin Dashboard.
5. Create further Super Admins from **Users & Roles → Add User → Role: Super Admin**.

> **Security:** `VITE_` variables are compiled into the client bundle and are
> visible to anyone who can download the JS. Use a strong, unique password,
> restrict access to the deployed site, and remove/rotate the variables once the
> first Super Admin has been created (existing accounts are unaffected).

## 4. Thermal Receipt Printing

Receipts print through the browser's print dialog by default. To print silently
to a USB/thermal till printer, each till machine also runs the bundled **local
print bridge**:

```bash
npm run print-bridge
```

It is optional — without it the app falls back to the browser dialog — and it
binds to `127.0.0.1` only, so it is never reachable from another machine.

- Optional app variable: `VITE_PRINT_BRIDGE_URL` (default
  `http://127.0.0.1:9210`)
- Bridge variables (`PRINT_BRIDGE_*`, `PRINT_TRANSPORT`, `PRINT_PRINTER`,
  `PRINT_NETWORK_*`, `PRINT_SPOOL_DIR`) are read by the bridge process, not the
  browser — see `.env.example`.

**Important:** the app and the bridge must run on the same machine as the
printer. A normal web deployment (e.g. Render) hosts only the app; the bridge
belongs on the shop's till PC, started at Windows log-on. The shop owner picks
the output path in **Settings → Terminal Settings → Receipt Output** (applies
to every open till; cashiers cannot change it) and confirms the connection with
**Test Print**.

Full setup, transports, security model and troubleshooting:
**[docs/PRINTING.md](./PRINTING.md)**.
