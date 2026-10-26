/**
 * Loopback renderer server.
 *
 * The packaged desktop app serves the production web build (`dist/`) from a
 * tiny in-process HTTP server bound to 127.0.0.1 — it is NOT a dev server: it
 * only ever serves the built static files that ship inside the installer.
 *
 * Why a loopback http origin instead of `file://` or a custom scheme:
 *
 *  - The build emits absolute `/assets/...` URLs (unchanged `vite` base), so
 *    the app must be served from an http origin, exactly like production web
 *    hosting. No changes to the web build are required.
 *  - The local print bridge (`print-bridge/server.ts`) only accepts requests
 *    from loopback origins. Serving from `http://127.0.0.1:<port>` keeps
 *    thermal receipt printing working unchanged in the desktop build.
 *  - Both desktop windows share one origin, so they share localStorage
 *    (auth session, shop settings) exactly as two browser tabs would.
 *  - The CSP is injected here as an HTTP header — it applies to the desktop
 *    build only and never touches the deployed PWA.
 *
 * The port is stable across launches (preferred 9273, previously-used port
 * remembered in userData) so the origin — and therefore the login session —
 * survives restarts. If the preferred ports are taken the server falls back to
 * an ephemeral port rather than failing to start.
 */
import http from 'node:http';
import {createReadStream, existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';

/**
 * Content Security Policy for the desktop renderer.
 *
 * - `script-src 'self'` — only the bundled Vite assets; no inline script.
 * - `connect-src ... https: wss:` — the Supabase URL can be configured at
 *   runtime (Supabase Config modal), so https/wss endpoints generally, plus
 *   loopback for the local print bridge.
 * - `img-src ... https: data: blob:` — product images come from Supabase
 *   Storage; the rest of the app needs data/blob URIs.
 * - Google Fonts are the only external styles/fonts the app loads.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "connect-src 'self' https: wss: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
].join('; ');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** First port to try; the remembered port from the previous run wins. */
const PREFERRED_PORT = 9273;
const PORT_FALLBACK_LIMIT = 16;

export interface RendererServer {
  /** e.g. http://127.0.0.1:9273 — the stable origin of every desktop window. */
  origin: string;
  port: number;
  close(): Promise<void>;
}

function serveFile(
  res: http.ServerResponse,
  filePath: string,
  status = 200,
): void {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(status, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-cache',
  });
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.pipe(res);
}

function createHandler(distDir: string): http.RequestListener {
  const indexHtml = path.join(distDir, 'index.html');
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, {Allow: 'GET, HEAD'});
      res.end();
      return;
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (pathname.includes('\0')) {
      res.writeHead(400);
      res.end();
      return;
    }

    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const target = path.resolve(distDir, rel);

    // Containment: never escape the build directory.
    if (target !== distDir && !target.startsWith(distDir + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }

    try {
      const stat = statSync(target);
      if (stat.isDirectory()) {
        const indexPath = path.join(target, 'index.html');
        if (existsSync(indexPath)) {
          if (req.method === 'HEAD') {
            serveHead(res, indexPath);
          } else {
            serveFile(res, indexPath);
          }
          return;
        }
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method === 'HEAD') {
        serveHead(res, target);
        return;
      }
      serveFile(res, target);
      return;
    } catch {
      // Unknown path without an extension → SPA fallback (and we do have no
      // router today, but this keeps deep links working if one is added).
      if (!path.extname(rel) && existsSync(indexHtml)) {
        if (req.method === 'HEAD') {
          serveHead(res, indexHtml);
        } else {
          serveFile(res, indexHtml);
        }
        return;
      }
      res.writeHead(404);
      res.end();
    }
  };
}

function serveHead(res: http.ServerResponse, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  const {size} = statSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-cache',
    'Content-Length': size,
  });
  res.end();
}

function readRememberedPort(portFile: string): number | null {
  try {
    const value = Number.parseInt(readFileSync(portFile, 'utf8').trim(), 10);
    return Number.isInteger(value) && value > 1024 && value < 65536 ? value : null;
  } catch {
    return null;
  }
}

async function listenOn(server: http.Server, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      resolve(err.code !== 'EADDRINUSE');
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(true);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Start the renderer server for the production `dist/` directory.
 * Rejects (rather than starting without a CSP) if the build directory is
 * missing — the caller shows a clear error instead of a blank window.
 */
export async function startRendererServer(distDir: string, portFile: string): Promise<RendererServer> {
  if (!existsSync(path.join(distDir, 'index.html'))) {
    throw new Error(
      `Production build not found at ${distDir}. Run "pnpm build" before starting the desktop app.`,
    );
  }

  const handler = createHandler(path.resolve(distDir));
  const server = http.createServer(handler);
  server.keepAliveTimeout = 30_000;

  // Stable origin across launches: remembered port first, then the preferred
  // range, then an ephemeral port as a last resort (never fail to start).
  const candidates: number[] = [];
  const remembered = readRememberedPort(portFile);
  if (remembered !== null) candidates.push(remembered);
  for (let port = PREFERRED_PORT; port < PREFERRED_PORT + PORT_FALLBACK_LIMIT; port++) {
    if (!candidates.includes(port)) candidates.push(port);
  }

  let chosen = -1;
  for (const port of candidates) {
    if (await listenOn(server, port)) {
      chosen = port;
      break;
    }
  }
  if (chosen === -1) {
    if (!(await listenOn(server, 0))) {
      throw new Error('Could not bind the local renderer server to 127.0.0.1.');
    }
    const address = server.address();
    chosen = typeof address === 'object' && address ? address.port : 0;
  } else {
    try {
      writeFileSync(portFile, String(chosen), 'utf8');
    } catch {
      // Non-fatal: the port just won't be remembered next launch.
    }
  }

  return {
    origin: `http://127.0.0.1:${chosen}`,
    port: chosen,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections?.();
      }),
  };
}
