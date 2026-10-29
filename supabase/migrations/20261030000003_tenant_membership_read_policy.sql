-- ---------------------------------------------------------------------------
-- MIGRATION 3: let a signed-in user READ their own tenant membership
--
-- SYMPTOM THIS FIXES
--   A shop registers successfully (the owner + shop + membership are created),
--   but the owner cannot sign in: the app reports
--       "This account is not linked to an active shop."
--
-- WHY
--   public.tenant_memberships has RLS ENABLED (20261020000001) but, until now,
--   NO policy at all. Two very different code paths touch that table:
--
--     * create_tenant_with_owner / invite_staff / claim_legacy_profile are
--       SECURITY DEFINER — they run as the function owner, BYPASS RLS, and so
--       INSERT the membership row without any policy. Registration therefore
--       "works".
--     * resolveAuthUser (the sign-in resolver) reads tenant_memberships AS THE
--       AUTHENTICATED OWNER to prove the identity belongs to an active shop.
--       That read is subject to RLS. With RLS on and zero policies, Postgres
--       filters out every row, the resolver sees no membership, and refuses
--       the sign-in — even though the row is right there.
--
--   In short: the row could be written but never read back by its own owner.
--
-- THE FIX
--   A single SELECT policy scoped to the caller's own rows:
--       USING (user_id = auth.uid())
--   A user may see only the memberships that belong to them. This is the
--   minimum needed for sign-in and leaks nothing else — an owner still cannot
--   enumerate other users' memberships, and a super admin's platform-wide
--   visibility continues to come from is_super_admin() in the other policies,
--   not from here.
--
--   No INSERT/UPDATE/DELETE policy is added: membership writes remain the
--   exclusive job of the SECURITY DEFINER RPCs (and the trusted service role),
--   which is the whole point of the trusted-provisioning design. A tampered
--   client still cannot mint itself a membership.
--
-- IDEMPOTENT: safe to re-run.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Members read own membership" ON public.tenant_memberships;
CREATE POLICY "Members read own membership" ON public.tenant_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
