import 'dotenv/config';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express, {type Request as ExpressRequest, type Response as ExpressResponse} from 'express';
import {createServer as createViteServer} from 'vite';
import {GET as statusGet} from './landing/api/status.ts';
import {GET as plansGet} from './landing/api/plans.ts';
import {POST as checkoutPost} from './landing/api/checkout.ts';
import {POST as verifyPost} from './landing/api/verify.ts';
import {GET as subscriptionGet, POST as subscriptionPost} from './landing/api/subscription.ts';
import {GET as contactGet, POST as contactPost} from './landing/api/contact.ts';
import {POST as paystackWebhookPost} from './landing/api/webhooks/paystack.ts';
import {apiError} from './landing/api/_lib/http.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

function toWebRequest(req: ExpressRequest): Request {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto =
    (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0]?.trim() : undefined) ||
    req.protocol ||
    'http';
  const forwardedHost = req.headers['x-forwarded-host'];
  const host =
    (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0]?.trim() : undefined) ||
    req.get('host') ||
    `localhost:${PORT}`;
  const url = `${proto}://${host}${req.originalUrl}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  const method = req.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const body =
    hasBody && Buffer.isBuffer(req.body) && req.body.length > 0 ? new Uint8Array(req.body) : undefined;

  return new Request(url, {method, headers, body});
}

async function sendWebResponse(res: ExpressResponse, webResponse: Response): Promise<void> {
  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const payload = Buffer.from(await webResponse.arrayBuffer());
  res.send(payload);
}

type WebHandler = (request: Request) => Response | Promise<Response>;

function adapt(handler: WebHandler) {
  return async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const webReq = toWebRequest(req);
      const webRes = await handler(webReq);
      await sendWebResponse(res, webRes);
    } catch (cause) {
      console.error(`server: unhandled API error on ${req.method} ${req.originalUrl}:`, cause);
      await sendWebResponse(res, apiError(500, 'internal_error', 'Unexpected server error.'));
    }
  };
}

async function start(): Promise<void> {
  const app = express();
  app.set('trust proxy', true);

  // Preserve raw bytes on /api/* so Paystack HMAC-SHA512 webhook signatures
  // verify against the exact payload bytes while JSON routes also work cleanly.
  const apiRouter = express.Router();
  apiRouter.use(express.raw({type: '*/*', limit: '2mb'}));

  apiRouter.all('/status', adapt(statusGet));
  apiRouter.all('/plans', adapt(plansGet));
  apiRouter.all('/checkout', adapt(checkoutPost));
  apiRouter.all('/verify', adapt(verifyPost));
  apiRouter.all('/subscription', (req, res) => {
    if (req.method.toUpperCase() === 'POST') return adapt(subscriptionPost)(req, res);
    return adapt(subscriptionGet)(req, res);
  });
  apiRouter.all('/contact', (req, res) => {
    if (req.method.toUpperCase() === 'POST') return adapt(contactPost)(req, res);
    return adapt(contactGet)(req, res);
  });
  apiRouter.all('/webhooks/paystack', adapt(paystackWebhookPost));
  apiRouter.use((_req, res) => {
    void sendWebResponse(res, apiError(404, 'not_found', 'API endpoint not found.'));
  });

  app.use('/api', apiRouter);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`SamTill server listening on http://${HOST}:${PORT}`);
  });
}

void start();
