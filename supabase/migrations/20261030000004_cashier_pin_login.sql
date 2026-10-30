-- =============================================================================
-- Cashier PIN login: server-side verifier + owner-managed PIN store
-- =============================================================================
--
-- WHAT THIS IS FOR
--   Cashiers sign in by picking their name and entering a 4-6 digit PIN instead
--   of an email + password. Shop owners and super admins keep Supabase Auth
--   email + password — nothing about that flow changes here. The PIN is
--   verified on the backend whenever the till has a connection; the till also
--   keeps its own salted hash so a cashier can still sign in (and sell) during
--   an outage — see src/lib/pinAuth.ts and docs/SECURITY.md §3b.5.
--
-- WHY A SEPARATE TABLE (not a column on public.users)
--   1. public.users.password/pin are legacy PLAINTEXT columns that Stage B
--      (20261029000001) scrubs and that the app never mirrors or reads. Adding
--      a secret next to them would be an easy mistake for a later migration to
--      undo.
--   2. Stage B may not be applied yet. Until it is, public.users still carries
--      permissive `FOR ALL TO anon USING (true)` policies from
--      20261024000002 — a pin_hash column there would be readable by anyone
--      holding the anon key (it is in the client bundle), and a 4-digit PIN
--      hash is cheap to brute force offline.
--   `cashier_pins` instead enables RLS with NO policies: every client role is
--   deny-all by construction, whatever else is or is not applied around it.
--   Only the two SECURITY DEFINER functions below (which run as the table
--   owner) ever touch it.
--
-- WHY ANON MAY CALL EXACTLY ONE FUNCTION
--   The sign-in screen runs with no session, so the verifier has to be
--   reachable pre-authentication. That is a deliberate, narrow exception to
--   Stage B's "anon holds nothing" rule (§3 of that migration):
--     • `GRANT USAGE ON SCHEMA public TO anon` restores schema visibility only.
--       Stage B revoked every anon TABLE and SEQUENCE privilege, and RLS denies
--       the rest, so anon still cannot read or write a single row.
--     • `verify_cashier_pin` is the only function anon may execute. It returns
--       a status word + counters for one (tenant, cashier, pin) triple and
--       never returns the hash, never lists users, and locks the PIN after 5
--       wrong guesses for 15 minutes server-side.
--   This migration also stops future functions from inheriting PUBLIC/anon
--   EXECUTE by default, so the exception cannot quietly widen later.
--
-- LOCKOUT POLICY (enforced here, not only on the device): 5 consecutive wrong
--   PINs lock that cashier's PIN for 15 minutes; a correct PIN or expiry
--   resets the counter.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. PIN store — one row per cashier, deny-all to every client role
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cashier_pins (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    -- bcrypt (pgcrypto `crypt` + `gen_salt('bf')`), never plaintext. A PIN is
    -- low-entropy, so the cost-10 bcrypt work factor is the point: it is what
    -- makes an offline brute force of a 4-digit PIN expensive.
    pin_hash TEXT NOT NULL,
    failed_count INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_cashier_pins_tenant_id ON public.cashier_pins(tenant_id);

-- RLS with zero policies = deny-all for anon AND authenticated. The table
-- owner (and therefore SECURITY DEFINER functions) still gets in; nobody else
-- does, no matter how the surrounding grants evolve.
ALTER TABLE public.cashier_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cashier_pins FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. verify_cashier_pin — the login-screen verifier (anon + authenticated)
-- -----------------------------------------------------------------------------
-- Returns jsonb so the client gets a status word rather than an exception:
--   {status:'ok', id, tenant_id, shop_name, full_name, email, phone, role,
--            is_active, created_at}
--   {status:'invalid', attempts_left}         wrong PIN, lockout not reached
--   {status:'locked',  retry_after}           locked (seconds), correct PIN too
--   {status:'inactive'}                       cashier is deactivated
--   {status:'no_user'|'no_pin'}               nothing to verify server-side
--                                             (caller may fall back to the
--                                             device-held hash)
-- `no_user`/`no_pin` are intentionally indistinguishable from each other to an
-- anonymous prober and leak no roster information: they carry no fields.
CREATE OR REPLACE FUNCTION public.verify_cashier_pin(
    p_tenant_id UUID,
    p_user_id UUID,
    p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_pin RECORD;
    v_now TIMESTAMPTZ := now();
    v_failed INTEGER;
    v_ok BOOLEAN;
BEGIN
    -- Shape check first: nothing outside 4-6 digits is ever a valid PIN, and
    -- rejecting it here keeps crypt() out of the loop for junk input.
    IF p_tenant_id IS NULL OR p_user_id IS NULL
       OR p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN
        RETURN jsonb_build_object('status', 'invalid', 'attempts_left', 0);
    END IF;

    -- Shop scoping: the cashier must belong to the tenant the till claims.
    -- A caller cannot verify a PIN for a cashier of another shop by passing a
    -- borrowed user id, and `role = 'cashier'` keeps this RPC from ever
    -- verifying an owner's or super admin's credential.
    SELECT * INTO v_user
      FROM public.users u
     WHERE u.id = p_user_id
       AND u.tenant_id = p_tenant_id
       AND u.role = 'cashier';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'no_user');
    END IF;
    IF NOT v_user.is_active THEN
        RETURN jsonb_build_object('status', 'inactive');
    END IF;

    SELECT cp.pin_hash, cp.failed_count, cp.locked_until
      INTO v_pin
      FROM public.cashier_pins cp
     WHERE cp.user_id = p_user_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'no_pin');
    END IF;

    -- Active lockout wins even over the correct PIN: that is what makes the
    -- lockout meaningful against a guessing attack.
    IF v_pin.locked_until IS NOT NULL AND v_pin.locked_until > v_now THEN
        RETURN jsonb_build_object(
            'status', 'locked',
            'retry_after', EXTRACT(EPOCH FROM (v_pin.locked_until - v_now))::INTEGER
        );
    END IF;

    -- bcrypt compare: `crypt(pin, stored)` re-derives with the stored salt.
    v_ok := (v_pin.pin_hash = public.crypt(p_pin, v_pin.pin_hash));

    IF NOT v_ok THEN
        v_failed := COALESCE(v_pin.failed_count, 0) + 1;
        IF v_failed >= 5 THEN
            UPDATE public.cashier_pins
               SET failed_count = v_failed,
                   locked_until = v_now + INTERVAL '15 minutes',
                   updated_at = v_now
             WHERE user_id = p_user_id;
            RETURN jsonb_build_object('status', 'locked', 'retry_after', 900);
        END IF;
        UPDATE public.cashier_pins
           SET failed_count = v_failed,
               locked_until = NULL,
               updated_at = v_now
         WHERE user_id = p_user_id;
        RETURN jsonb_build_object('status', 'invalid', 'attempts_left', 5 - v_failed);
    END IF;

    -- Correct PIN: clear the counter and hand the caller the identity fields
    -- it needs to open the existing cashier session (sales keep recording
    -- against this cashier's id and name).
    UPDATE public.cashier_pins
       SET failed_count = 0,
           locked_until = NULL,
           updated_at = v_now
     WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
        'status', 'ok',
        'id', v_user.id,
        'tenant_id', v_user.tenant_id,
        'shop_name', v_user.shop_name,
        'full_name', v_user.full_name,
        'email', v_user.email,
        'phone', v_user.phone,
        'role', v_user.role,
        'is_active', v_user.is_active,
        'created_at', v_user.created_at
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. set_cashier_pin — owner-managed assign / reset (authenticated only)
-- -----------------------------------------------------------------------------
-- Re-checks the caller inside the DEFINER context: `is_tenant_owner()` reads
-- auth.uid(), so anon (no uid) and any member of a different shop are refused
-- even if a future grant were to widen this function's reach.
CREATE OR REPLACE FUNCTION public.set_cashier_pin(
    p_tenant_id UUID,
    p_user_id UUID,
    p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_target public.users%ROWTYPE;
BEGIN
    IF p_tenant_id IS NULL OR p_user_id IS NULL THEN
        RETURN jsonb_build_object('status', 'invalid_pin');
    END IF;
    IF NOT public.is_tenant_owner(p_tenant_id) THEN
        RETURN jsonb_build_object('status', 'forbidden');
    END IF;
    IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN
        RETURN jsonb_build_object('status', 'invalid_pin');
    END IF;

    -- Only cashiers get a PIN, and only from their own shop's roster.
    SELECT * INTO v_target
      FROM public.users u
     WHERE u.id = p_user_id
       AND u.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        -- The roster row has not synced yet; the caller queues this write and
        -- retries so the PIN still lands rather than failing the owner's save.
        RETURN jsonb_build_object('status', 'no_user');
    END IF;
    IF v_target.role <> 'cashier' THEN
        RETURN jsonb_build_object('status', 'not_cashier');
    END IF;

    INSERT INTO public.cashier_pins AS cp
        (user_id, tenant_id, pin_hash, failed_count, locked_until, updated_at)
    VALUES
        (p_user_id, p_tenant_id, public.crypt(p_pin, public.gen_salt('bf', 10)), 0, NULL, now())
    ON CONFLICT (user_id) DO UPDATE
        SET pin_hash = EXCLUDED.pin_hash,
            tenant_id = EXCLUDED.tenant_id,
            failed_count = 0,          -- assigning a PIN clears any lockout
            locked_until = NULL,
            updated_at = now();

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Grants — anon reaches the verifier and nothing else
-- -----------------------------------------------------------------------------
-- (Idempotent: harmless if Stage B has already run; required if it has not.)
GRANT USAGE ON SCHEMA public TO anon;

REVOKE EXECUTE ON FUNCTION public.verify_cashier_pin(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_cashier_pin(UUID, UUID, TEXT) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.set_cashier_pin(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_cashier_pin(UUID, UUID, TEXT) TO authenticated;

-- New functions must not silently inherit PUBLIC/anon EXECUTE (PostgreSQL
-- defaults every function to PUBLIC). Existing RPCs already grant explicitly —
-- create_tenant_with_owner, invite_staff, claim_legacy_profile, etc. — so this
-- only pins the convention down for whatever comes next.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

COMMIT;
