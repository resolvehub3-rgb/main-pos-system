-- =============================================================================
-- Stage B (PROVISIONING RPC — NOT APPLIED): trusted server-side account setup
-- =============================================================================
--
-- WHY THIS EXISTS
--   The Stage B lockdown migration (20261029000001) deliberately leaves
--   `tenants` INSERT ungranted to clients and drops every anon grant, so a
--   signed-in client can no longer mint a tenant, profile or membership row by
--   itself. That is correct — but a new shop still has to be created somehow.
--   SQL cannot create an `auth.users` row (that is the Admin API / `signUp`),
--   but everything AFTER the auth user exists — the tenant, the owner's
--   profile, the ownership membership, and staff invitations — is done here in
--   a trusted, server-side SECURITY DEFINER function instead of a client insert.
--
--   There is no POS backend server in this repository (render.yaml and
--   docs/API.md describe one that is not implemented), and the landing API runs
--   against the separate commerce Supabase project, so a Postgres SECURITY
--   DEFINER RPC is the correct trusted boundary: it runs inside the POS project,
--   carries the service-role-equivalent privileges for the few writes it makes,
--   and is constrained to act ONLY on the caller's own auth.uid().
--
-- TRUST MODEL (what makes these safe despite SECURITY DEFINER)
--   • Every function starts by reading `auth.uid()`. NULL (anon / service role
--     with no JWT) is refused, except where documented. A caller can never name
--     an arbitrary user_id to act as — the subject is always auth.uid().
--   • Roles are NEVER taken from the client as-is. `super_admin` is refused
--     outright; the only role a provisioning call can assign is one the schema
--     allows AND the caller is already entitled to grant. No path here can mint
--     a super admin.
--   • Authorization for cross-user writes (invite_staff) is re-checked inside
--     the function with the SECURITY DEFINER helpers (is_tenant_owner), because
--     RLS is bypassed by SECURITY DEFINER and would otherwise not apply.
--   • search_path is pinned on every function to block search_path injection.
--   • Functions are EXECUTE-denied to PUBLIC/anon and granted only to
--     `authenticated`.
--
-- ORDER OF OPERATIONS (client)
--   New shop : supabase.auth.signUp() -> (confirm email if required) ->
--              supabase.rpc('create_tenant_with_owner', ...).
--   Staff    : owner calls supabase.rpc('invite_staff', ...) for a person who
--              ALREADY has a Supabase Auth account (matches by email). Creating
--              an auth user + sending the invitation email requires the Admin
--              API and therefore a trusted server — see docs/SECURITY.md §6.
--   Legacy   : a legacy user who signs up with the SAME verified email calls
--              supabase.rpc('claim_legacy_profile', ...) to link their new
--              auth identity to their existing roster row + membership.
--
-- WHAT THIS DOES NOT DO
--   • It does not create auth.users rows or send emails (Admin API only).
--   • It does not grant, infer, or permit super_admin.
--   • It is NOT applied to any database here. It is reviewed, unapplied SQL.
--
-- RELATIONSHIP TO Stage B LOCKDOWN
--   This migration is independent of 20261029000001 and should be applied in the
--   same window (after accounts are provisioned, before/at cutover). It does not
--   re-enable anon, does not widen any RLS policy, and does not touch credentials.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. create_tenant_with_owner — a new shop, provisioned server-side
-- -----------------------------------------------------------------------------
-- Called by a freshly signed-up owner (auth.uid() present). Creates the tenant,
-- its main branch, the owner's profile (role pinned to shop_owner) and the
-- ownership membership, atomically. IDEMPOTENT: if the caller already owns a
-- shop, the existing tenant id is returned instead of a second shop.
--
-- SECURITY DECISIONS
--   • Role is a literal 'shop_owner'. The function has no parameter that could
--     carry a role, so a tampered client cannot ask for super_admin (or even
--     cashier) here — this is a shop-OWNER signup.
--   • The profile's email is read from auth.users (the verified identity), never
--     from client input, so a caller cannot create a profile under someone
--     else's email.
--   • The escalation trigger (block_super_admin_escalation) still fires on the
--     profiles INSERT; because the role is 'shop_owner' it passes, and it would
--     reject any attempt to make it 'super_admin'.
CREATE OR REPLACE FUNCTION public.create_tenant_with_owner(
    p_shop_name TEXT,
    p_shop_address TEXT DEFAULT NULL,
    p_owner_name TEXT DEFAULT NULL,
    p_owner_phone TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_email TEXT;
    v_full_name TEXT;
    v_phone TEXT;
    v_existing_tenant UUID;
    v_tenant UUID;
    v_slug TEXT;
    v_slug_base TEXT;
    v_suffix INT := 0;
    v_branch UUID;
BEGIN
    -- Anon (no JWT) must not provision. auth.uid() is NULL only for the anon
    -- role or a JWT-less service call; both are refused here.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated'
            USING ERRCODE = '42501',
                  HINT = 'Sign in (or confirm your email) before creating a shop.';
    END IF;

    IF p_shop_name IS NULL OR btrim(p_shop_name) = '' THEN
        RAISE EXCEPTION 'Shop name is required'
            USING ERRCODE = '22023';
    END IF;

    -- The verified email from auth.users — the identity this signup really is.
    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
    IF v_email IS NULL THEN
        RAISE EXCEPTION 'No verified identity for this session'
            USING ERRCODE = '42501';
    END IF;

    -- IDEMPOTENCY: if this identity already owns an active shop, return it.
    SELECT tm.tenant_id INTO v_existing_tenant
      FROM public.tenant_memberships tm
     WHERE tm.user_id = v_uid
       AND tm.role = 'shop_owner'
       AND tm.is_active = true
     LIMIT 1;
    IF v_existing_tenant IS NOT NULL THEN
        RETURN v_existing_tenant;
    END IF;

    v_full_name := COALESCE(NULLIF(btrim(COALESCE(p_owner_name, '')), ''), split_part(v_email, '@', 1));
    v_phone := NULLIF(btrim(COALESCE(p_owner_phone, '')), '');

    -- Unique slug: base from the shop name, then a numeric suffix on collision.
    v_slug_base := lower(regexp_replace(btrim(p_shop_name), '[^a-z0-9]+', '-', 'g'));
    v_slug_base := trim(both '-' from v_slug_base);
    IF v_slug_base = '' THEN
        v_slug_base := 'shop';
    END IF;
    v_slug := v_slug_base;
    WHILE EXISTS (SELECT 1 FROM public.tenants t WHERE t.slug = v_slug) LOOP
        v_suffix := v_suffix + 1;
        v_slug := v_slug_base || '-' || v_suffix;
    END LOOP;

    INSERT INTO public.tenants (name, slug, address, phone, email, currency, is_active, subscription_status)
    VALUES (btrim(p_shop_name), v_slug, NULLIF(btrim(COALESCE(p_shop_address, '')), ''), v_phone, v_email,
            'GHS', true, 'trial')
    RETURNING id INTO v_tenant;

    INSERT INTO public.branches (tenant_id, name, code, is_main, is_active, address, phone)
    VALUES (v_tenant, btrim(p_shop_name) || ' Main Branch', 'MAIN', true, true,
            NULLIF(btrim(COALESCE(p_shop_address, '')), ''), v_phone)
    RETURNING id INTO v_branch;

    -- Profile for the owner: role pinned, email from auth.users.
    INSERT INTO public.profiles (id, full_name, email, phone, role)
    VALUES (v_uid, v_full_name, v_email, v_phone, 'shop_owner')
    ON CONFLICT (id) DO UPDATE
        SET full_name = EXCLUDED.full_name,
            phone = COALESCE(EXCLUDED.phone, public.profiles.phone);

    INSERT INTO public.tenant_memberships (tenant_id, user_id, role, is_active, branch_id)
    VALUES (v_tenant, v_uid, 'shop_owner', true, v_branch)
    ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET role = 'shop_owner', is_active = true;

    RETURN v_tenant;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_tenant_with_owner(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_tenant_with_owner(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. invite_staff — a shop owner adds a team member to their own shop
-- -----------------------------------------------------------------------------
-- The caller must be an ACTIVE shop_owner of p_tenant_id (re-checked inside the
-- function, because SECURITY DEFINER bypasses RLS). The invited person must
-- ALREADY have a Supabase Auth account whose email matches p_email — creating
-- that auth user and emailing the invitation is an Admin API job for a trusted
-- server, not something SQL or the browser can do.
--
-- SECURITY DECISIONS
--   • p_role is validated against ('cashier','shop_owner'); 'super_admin' is
--     refused, so an owner can never escalate themselves or a hire via this path.
--   • The subject (the invited user) is found by matching the verified email in
--     auth.users — the caller cannot point the membership at an arbitrary uid.
--   • The membership is scoped to p_tenant_id AND verified to be a shop the
--     caller owns.
CREATE OR REPLACE FUNCTION public.invite_staff(
    p_tenant_id UUID,
    p_email TEXT,
    p_full_name TEXT,
    p_phone TEXT DEFAULT NULL,
    p_role TEXT DEFAULT 'cashier'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_role TEXT := lower(btrim(COALESCE(p_role, 'cashier')));
    v_email TEXT := lower(btrim(COALESCE(p_email, '')));
    v_staff UUID;
    v_full_name TEXT;
    v_phone TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Shop is required' USING ERRCODE = '22023';
    END IF;
    IF v_email = '' THEN
        RAISE EXCEPTION 'Staff email is required' USING ERRCODE = '22023';
    END IF;
    -- No escalation: a shop owner may add cashiers (or co-owners), never a
    -- super admin. super_admin is provisioned only via the Admin API/server.
    IF v_role NOT IN ('cashier', 'shop_owner') THEN
        RAISE EXCEPTION 'Only cashier or shop_owner may be invited'
            USING ERRCODE = '22023',
                  HINT = 'The super admin role cannot be granted from the app.';
    END IF;

    -- Re-check authorization inside the DEFINER context (RLS does not apply).
    IF NOT public.is_tenant_owner(p_tenant_id) THEN
        RAISE EXCEPTION 'Only the shop owner can invite staff'
            USING ERRCODE = '42501';
    END IF;

    -- The invited person must already exist in Supabase Auth, matched by the
    -- verified email. We never invent a uid from client input.
    SELECT u.id INTO v_staff FROM auth.users u WHERE lower(u.email) = v_email;
    IF v_staff IS NULL THEN
        RAISE EXCEPTION 'No account exists for that email yet'
            USING ERRCODE = 'P0002',
                  HINT = 'Ask the team member to sign up first, or send an invitation from the admin console (requires a trusted server).';
    END IF;

    v_full_name := COALESCE(NULLIF(btrim(COALESCE(p_full_name, '')), ''), split_part(v_email, '@', 1));
    v_phone := NULLIF(btrim(COALESCE(p_phone, '')), '');

    -- Ensure a profile exists for the invited user (role = the invited role).
    INSERT INTO public.profiles (id, full_name, email, phone, role)
    VALUES (v_staff, v_full_name, v_email, v_phone, v_role)
    ON CONFLICT (id) DO UPDATE
        SET full_name = EXCLUDED.full_name,
            phone = COALESCE(EXCLUDED.phone, public.profiles.phone);

    INSERT INTO public.tenant_memberships (tenant_id, user_id, role, is_active)
    VALUES (p_tenant_id, v_staff, v_role, true)
    ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET role = EXCLUDED.role, is_active = true;

    RETURN v_staff;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invite_staff(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.invite_staff(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. claim_legacy_profile — link a verified legacy identity to its roster row
-- -----------------------------------------------------------------------------
-- A pre-Auth account exists in public.users (roster) with an email but no auth
-- identity. When the owner signs up with that SAME verified email, this function
-- links the new auth.uid() to the existing roster row + tenant by creating the
-- profile + membership. This is the CONTROLLED re-invitation path: it never
-- invents a shop, it only attaches an authenticated identity to a roster row
-- that already carries that exact email.
--
-- SECURITY DECISIONS
--   • The auth user's email must be CONFIRMED (email_confirmed_at not null).
--     Without confirmation, a squatter could sign up with a victim's address and
--     claim their shop — so confirmation is a hard precondition.
--   • The roster row is matched by the exact verified email, and only an ACTIVE
--     row can be claimed.
--   • Role is copied from the roster row but coerced: 'super_admin' becomes
--     'shop_owner' (a legacy row is never a route to super admin). A later,
--     separate server action is required to make a real super admin.
--   • Idempotent: if the identity is already linked, the existing tenant is
--     returned.
CREATE OR REPLACE FUNCTION public.claim_legacy_profile()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_email TEXT;
    v_confirmed TIMESTAMPTZ;
    v_existing_tenant UUID;
    v_roster RECORD;
    v_role TEXT;
    v_branch UUID;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    -- Require a CONFIRMED email so a claim always binds a verified address.
    SELECT email, email_confirmed_at INTO v_email, v_confirmed
      FROM auth.users WHERE id = v_uid;
    IF v_email IS NULL OR v_confirmed IS NULL THEN
        RAISE EXCEPTION 'Email address must be confirmed before claiming an account'
            USING ERRCODE = '42501';
    END IF;

    -- Idempotent: already linked to an active shop?
    SELECT tm.tenant_id INTO v_existing_tenant
      FROM public.tenant_memberships tm
     WHERE tm.user_id = v_uid AND tm.is_active = true
     LIMIT 1;
    IF v_existing_tenant IS NOT NULL THEN
        RETURN v_existing_tenant;
    END IF;

    -- Find the active roster row carrying this exact verified email.
    SELECT r.id, r.tenant_id, r.role INTO v_roster
      FROM public.users r
     WHERE lower(r.email) = lower(v_email)
       AND r.is_active = true
       AND r.tenant_id IS NOT NULL
     LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active legacy account matches this email'
            USING ERRCODE = 'P0002',
                  HINT = 'Ask your shop owner to invite you, or register a new shop.';
    END IF;

    -- Never propagate super_admin from a legacy row through this self-serve path.
    v_role := CASE WHEN v_roster.role = 'super_admin' THEN 'shop_owner' ELSE v_roster.role END;

    -- Take the tenant's main branch if one exists (membership.branch_id nullable).
    SELECT b.id INTO v_branch FROM public.branches b
     WHERE b.tenant_id = v_roster.tenant_id AND b.is_main = true
     LIMIT 1;

    INSERT INTO public.profiles (id, full_name, email, phone, role)
    VALUES (v_uid,
            COALESCE((SELECT r2.full_name FROM public.users r2 WHERE r2.id = v_roster.id), split_part(v_email, '@', 1)),
            lower(v_email),
            (SELECT r3.phone FROM public.users r3 WHERE r3.id = v_roster.id),
            v_role)
    ON CONFLICT (id) DO UPDATE
        SET role = EXCLUDED.role;

    INSERT INTO public.tenant_memberships (tenant_id, user_id, role, is_active, branch_id)
    VALUES (v_roster.tenant_id, v_uid, v_role, true, v_branch)
    ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET is_active = true;

    RETURN v_roster.tenant_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_legacy_profile() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.claim_legacy_profile() TO authenticated;

COMMIT;
