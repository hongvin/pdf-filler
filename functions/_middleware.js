/**
 * Access gate.
 *
 * This app holds an IC number, which is not something to leave sitting on a
 * public *.pages.dev URL. So:
 *
 *   - APP_PASSWORD set   -> the whole site sits behind HTTP Basic auth.
 *   - APP_PASSWORD unset -> static files still serve (so you can see why it is
 *     broken), but /api/* is refused. That direction matters: the sensitive
 *     endpoint fails *closed*, never open.
 *
 * The password is compared in constant time so the gate does not leak its own
 * length through response timing.
 */

function constantTimeEqual(a, b) {
  const x = String(a == null ? '' : a);
  const y = String(b == null ? '' : b);
  // Fold the length difference into the result rather than returning early.
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function decodeBasic(header) {
  try {
    const decoded = atob(header.slice(6).trim());
    const idx = decoded.indexOf(':');
    if (idx < 0) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

const json = (body, status, extra) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // `public/_headers` only covers static assets, not Functions responses, so
    // the baseline hardening has to be repeated here.
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(extra || {}),
  },
});

export async function onRequest(context) {
  const { request, env, next } = context;
  const path = new URL(request.url).pathname;
  const password = env.APP_PASSWORD;

  if (!password) {
    if (path.startsWith('/api/')) {
      return json({
        error: 'not_configured',
        message: 'APP_PASSWORD is not set, so /api/config is switched off. '
          + 'Set it with:  npx wrangler pages secret put APP_PASSWORD --project-name <project>',
      }, 503);
    }
    return next();
  }

  const header = request.headers.get('Authorization') || '';
  if (header.startsWith('Basic ')) {
    const creds = decodeBasic(header);
    const userOk = constantTimeEqual(creds && creds.user, env.APP_USER || 'bidder');
    const passOk = constantTimeEqual(creds && creds.pass, password);
    if (creds && userOk && passOk) return next();
  }

  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Form Filler", charset="UTF-8"',
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    },
  });
}
