import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function respond(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond(405, { message: 'Method not allowed.' });

  const authorization = request.headers.get('Authorization') ?? '';
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return respond(401, { message: 'Sign in as the shop owner and try again.' });

  let input: Record<string, unknown>;
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return respond(400, { message: 'Staff details are incomplete.' });
    }
    input = body as Record<string, unknown>;
  } catch {
    return respond(400, { message: 'Staff details are not valid JSON.' });
  }

  const tenantId = typeof input.tenant_id === 'string' ? input.tenant_id : '';
  const fullName = typeof input.full_name === 'string' ? input.full_name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const role = input.role;

  if (
    !UUID_PATTERN.test(tenantId) ||
    !fullName ||
    fullName.length > 120 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    phone.length > 40 ||
    password.length < 6 ||
    password.length > 128 ||
    (role !== 'cashier' && role !== 'shop_owner')
  ) {
    return respond(400, { message: 'Check the staff name, email, role, and password and try again.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Staff provisioning is missing required Supabase environment settings.');
    return respond(503, { message: 'Staff login setup is unavailable. Please contact support.' });
  }

  const ownerClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  let callerId = '';
  try {
    const { data, error } = await ownerClient.auth.getUser(accessToken);
    if (error || !data.user) {
      return respond(401, { message: 'Your sign-in has expired. Sign in again and retry.' });
    }
    callerId = data.user.id;
  } catch (error) {
    console.error(`Could not verify staff-provisioning caller: ${error instanceof Error ? error.message : String(error)}`);
    return respond(503, { message: 'Could not verify your sign-in. Please retry.' });
  }

  let isOwner = false;
  try {
    const { data: membership, error } = await ownerClient
      .from('tenant_memberships')
      .select('tenant_id')
      .eq('tenant_id', tenantId)
      .eq('user_id', callerId)
      .eq('role', 'shop_owner')
      .eq('is_active', true)
      .maybeSingle();
    if (error) {
      console.error(`Could not verify staff-provisioning owner ${callerId}: ${error.message}`);
      return respond(503, { message: 'Could not verify shop ownership. Please retry.' });
    }
    isOwner = Boolean(membership);
  } catch (error) {
    console.error(`Could not verify staff-provisioning owner ${callerId}: ${error instanceof Error ? error.message : String(error)}`);
    return respond(503, { message: 'Could not verify shop ownership. Please retry.' });
  }
  if (!isOwner) return respond(403, { message: 'Only this shop’s owner can add staff.' });

  let tenantName = '';
  try {
    const { data: tenant, error } = await ownerClient
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .maybeSingle();
    if (error || !tenant) {
      console.error(`Could not load tenant for staff provisioning: ${error?.message ?? 'not found'}`);
      return respond(503, { message: 'Could not load the shop details. Please retry.' });
    }
    tenantName = tenant.name;
  } catch (error) {
    console.error(`Could not load tenant for staff provisioning: ${error instanceof Error ? error.message : String(error)}`);
    return respond(503, { message: 'Could not load the shop details. Please retry.' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let createdUserId = '';
  let createdAt = '';
  try {
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, phone, role },
    });
    if (error || !data.user) {
      if (error?.code === 'email_exists' || error?.message.toLowerCase().includes('already')) {
        return respond(409, { message: 'That email already has a login. Use a different email address.' });
      }
      console.error(`Could not create staff Auth user: ${error?.message ?? 'no user returned'}`);
      return respond(400, { message: 'Could not create the staff login. Check the email and password and retry.' });
    }
    createdUserId = data.user.id;
    createdAt = data.user.created_at;
  } catch (error) {
    console.error(`Could not reach Auth while creating staff login: ${error instanceof Error ? error.message : String(error)}`);
    return respond(503, { message: 'Could not reach the login service. Check your connection and retry.' });
  }

  let failure: string | null = null;
  try {
    const { data: invitedUserId, error: inviteError } = await ownerClient.rpc('invite_staff', {
      p_tenant_id: tenantId,
      p_email: email,
      p_full_name: fullName,
      p_phone: phone || null,
      p_role: role,
    });
    if (inviteError || invitedUserId !== createdUserId) {
      failure = 'Could not add this login to the shop.';
      console.error(`Could not link staff Auth user ${createdUserId}: ${inviteError?.message ?? 'ID mismatch'}`);
    }
  } catch (error) {
    failure = 'Could not add this login to the shop.';
    console.error(`Could not link staff Auth user ${createdUserId}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!failure) {
    try {
      const { error: rosterError } = await ownerClient.from('users').upsert({
        id: createdUserId,
        tenant_id: tenantId,
        shop_name: tenantName,
        full_name: fullName,
        email,
        phone: phone || null,
        role,
        is_active: true,
        created_at: createdAt,
      });
      if (rosterError) {
        failure = 'Could not add this login to the shop roster.';
        console.error(`Could not save staff roster row ${createdUserId}: ${rosterError.message}`);
      }
    } catch (error) {
      failure = 'Could not add this login to the shop roster.';
      console.error(`Could not save staff roster row ${createdUserId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failure) {
    let rollbackFailed = false;
    try {
      const { error: rosterDeleteError } = await ownerClient
        .from('users')
        .delete()
        .eq('id', createdUserId);
      if (rosterDeleteError) {
        rollbackFailed = true;
        console.error(`Could not roll back staff roster row ${createdUserId}: ${rosterDeleteError.message}`);
      }
    } catch (error) {
      rollbackFailed = true;
      console.error(`Could not roll back staff roster row ${createdUserId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const { error: rollbackError } = await adminClient.auth.admin.deleteUser(createdUserId);
      if (rollbackError) {
        rollbackFailed = true;
        console.error(`Could not roll back staff Auth user ${createdUserId}: ${rollbackError.message}`);
      }
    } catch (error) {
      rollbackFailed = true;
      console.error(`Could not roll back staff Auth user ${createdUserId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (rollbackFailed) {
      return respond(500, {
        message: 'Staff setup did not finish and could not be rolled back. Contact support before retrying.',
      });
    }
    return respond(500, { message: `${failure} No login was kept; please retry.` });
  }

  return respond(200, { user_id: createdUserId });
});
