/**
 * POST /api/contact — submit a contact/enquiry message.
 *
 * STATUS: implemented; requires the commerce backend. Fails closed with 503
 *         `commerce_not_configured` until SUPABASE_COMMERCE_* is provisioned.
 *
 * Stores the enquiry in the `contact_enquiries` table (service role, bypasses
 * RLS) so SamTeck Digital can follow up. No authentication required — this is
 * a public enquiry form. Rate-limited per IP.
 */
import {getCommerceConfig} from './_lib/env.ts';
import {
  apiError,
  clientIp,
  json,
  methodGuard,
  notConfigured,
  rateLimited,
  readJsonBody,
} from './_lib/http.ts';
import {insertRow, BackendError} from './_lib/supabase.ts';
import {checkRateLimit, sharedBuckets} from './_lib/rate-limit.ts';

const CONTACT_RATE = {limit: 5, windowMs: 10 * 60 * 1000};
const MAX_MESSAGE = 4000;
const MAX_NAME = 120;
const MAX_EMAIL = 254;

interface ContactBody {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  package?: unknown;
  message?: unknown;
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

export async function POST(request: Request): Promise<Response> {
  const guard = methodGuard(request, 'POST');
  if (guard) return guard;

  const configResult = getCommerceConfig();
  if (!configResult.ok) return notConfigured(configResult.missing, configResult.invalid);
  const config = configResult.config;

  const ip = clientIp(request) ?? 'unknown';
  const rate = checkRateLimit(sharedBuckets, `contact:${ip}`, CONTACT_RATE, Date.now());
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const body = await readJsonBody<ContactBody>(request, 16 * 1024);
  if (!body.ok) return body.response;

  const {name, email, phone, package: pkg, message} = body.value;

  if (!isString(message) || message.trim() === '') {
    return apiError(400, 'invalid_message', 'A message is required.');
  }
  if (message.length > MAX_MESSAGE) {
    return apiError(400, 'message_too_long', `Message must be at most ${MAX_MESSAGE} characters.`);
  }
  if (name !== undefined && (!isString(name) || name.length > MAX_NAME)) {
    return apiError(400, 'invalid_name', `Name must be at most ${MAX_NAME} characters.`);
  }
  if (email !== undefined && email !== '' && (!isString(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > MAX_EMAIL)) {
    return apiError(400, 'invalid_email', 'A valid email address is required.');
  }
  if (phone !== undefined && phone !== '' && (!isString(phone) || phone.length > 40)) {
    return apiError(400, 'invalid_phone', 'Phone number is too long.');
  }
  if (pkg !== undefined && pkg !== '' && !isString(pkg)) {
    return apiError(400, 'invalid_package', 'Package must be a string.');
  }

  const row = {
    name: isString(name) ? name.trim() : null,
    email: isString(email) ? email.trim() : null,
    phone: isString(phone) ? phone.trim() : null,
    package: isString(pkg) ? pkg.trim() : null,
    message: message.trim(),
    ip,
    created_at: new Date().toISOString(),
  };

  try {
    await insertRow(config, 'contact_enquiries', row);
  } catch (cause) {
    console.error(`commerce: contact insert failed: ${String(cause)}`);
    return apiError(502, 'backend_unavailable', 'Could not send your enquiry right now. Please try again shortly, or email samteckdigital@gmail.com directly.');
  }

  return json({ok: true, message: 'Your enquiry was received. SamTeck Digital will be in touch.'}, 201);
}

export function GET(): Response {
  return apiError(405, 'method_not_allowed', 'Use POST.');
}