# 04 — Installer delivery & licensing

How the SamTill Windows installer is meant to reach paying subscribers — and
what is explicitly **not** built yet.

## 1. Installer reference (verified locally)

| Field | Value |
| --- | --- |
| File | `release/SamTill-POS-Setup.exe` (repository root, **not** in `landing/`) |
| Size | `125267865` bytes (119.46 MB) |
| SHA-256 | `C0694FCB7FEED8E21EF18C5D21CEE8392CF683F6671131E258BC3BC3EF97FF07` |
| Version | `1.0.0` |
| Min OS | Windows 10/11 x64 |
| Code signing | **Unsigned** — Windows SmartScreen may warn; a signing certificate is a separate purchase/decision |

Verification method: `Get-FileHash release\SamTill-POS-Setup.exe -Algorithm SHA256`
run locally on 2026-10-27 — both size and hash match the inactive seed row in
`db/migrations/0001_commerce_init.sql` exactly.

**Standing rules**
- The `.exe` is **never** committed to this repo, never uploaded anywhere,
  and never included in `landing/` source or `dist/` (greps confirm it is
  absent from the build).
- The SHA-256 above is the integrity anchor: the SQL seed row, this doc and
  the `/api/download` response must always agree with it.

## 2. Storage plan (not yet created)

- Bucket: `installers`, **private**, created in the dedicated **commerce**
  Supabase project (never the POS project).
- Object path (seeded, inactive): `pos/1.0.0/SamTill-POS-Setup.exe`
- Access: **service-role only**. All `storage.objects` policies are dropped
  in the migration and anon write privileges revoked — no public URL, ever.

### Upload procedure (owner-run, after approval)
1. Confirm the file hash matches §1 (`Get-FileHash … -Algorithm SHA256`).
2. In the commerce project's dashboard (or with the service-role key in a
   **local, non-committed** script), upload to
   `installers/pos/1.0.0/SamTill-POS-Setup.exe`.
3. Re-download the object once and re-verify the SHA-256 (catches corruption
   in transit/storage).
4. Flip the seed row live: `update installer_releases set is_active = true,
   published_at = now() where version = '1.0.0';` — **only** as part of an
   approved launch step.
5. Record who uploaded, when, and the verified hash in the audit log.

## 3. Download flow (implemented server-side)

`POST /api/download` (authenticated, 6/10 min per user):
1. Check access via `DOWNLOAD_ACCESS_MODE`: **`entitlement`** (default) requires
   an **active** entitlement (`valid_to` in the future; no grace); the opt-in
   **`verified_account`** mode instead accepts any email-verified account (owner
   decision, doc 01 §6). Neither mode makes registration a licence.
2. Server chooses the newest **active** `installer_releases` row — the client
   cannot select a version or path.
3. Write the `download_events` audit row **first**; if that write fails,
   respond `503 audit_unavailable` (fail-closed: no unaudited downloads).
4. Return a storage signed URL with TTL ≤ `DOWNLOAD_LINK_TTL_SECONDS`
   (default 300 s), plus `version`, `size_bytes`, `sha256`.
5. Denials are audited best-effort.

The customer-facing download page (`/#/download`, doc 05) consumes exactly this
endpoint: it shows the version/size/SHA-256 returned by the API (never
hard-coded in the client), streams the file with real progress, and explains
that this is the Windows installer — distinct from the web/PWA app.

### Client-side integrity check (for the customer)
After download, the file's SHA-256 must equal the value returned by the API
(and published here): `C0694FCB…97FF07`. If it differs, delete the file and
re-download. Because the binary is unsigned, this hash check plus the
short-lived private link is the current trust chain — which is also why a
code-signing certificate should be considered before broad release.

## 4. POS-side licence enforcement — NOT implemented

**Status: deliberately out of scope.** The POS application
(`release/`, the Electron app, its Supabase project) contains **no licence
checks of any kind**, and this preparation build does not add any. The
installer runs as it does today.

Reason: any enforcement inside the POS is a separate, approval-gated
integration with product-level consequences (blocking a paying customer's
shop mid-trade, offline grace, support burden). It requires its own design
doc and explicit owner approval, on top of doc 01.

When the owner approves that work, the options to evaluate (none chosen):
1. **Online activation** — POS asks the commerce API for a licence on first
   run (needs network; fails how, offline?).
2. **Signed licence file** — issued at purchase, validated offline against a
   public key baked into the build; expiry from `entitlements.valid_to`.
3. **Graceful degradation** — expiry only disables updates/downloads, never
   the till itself (recommended starting point: zero revenue risk).

Constraints to respect when designed: the POS keeps its own separate
credentials; no commerce secrets in the POS build; behaviour offline and at
`valid_to` must be defined before coding; tamper-resistance is limited on an
unsigned binary.

## 5. Open dependencies

| Item | State |
| --- | --- |
| Private bucket + upload | not created (needs commerce project + approval) |
| Seed row activation | `is_active = false` until launch approval |
| Code-signing certificate | undecided (cost vs SmartScreen warnings) |
| POS-side licence enforcement | not implemented; separate approval (§4) |
| Hash re-verification after each re-upload | procedural, mandatory |
