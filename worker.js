/**
 * Worker entry point.
 *
 * Static files are served from ./public through the ASSETS binding; the only
 * dynamic route is /api/config.
 *
 * This replaces the Pages Functions layout for one concrete reason: a Pages
 * project always exposes <project>.pages.dev and that hostname cannot be
 * removed or put behind Cloudflare Access (Access domains must belong to a
 * zone on the account, and pages.dev is Cloudflare's). A Worker's public
 * workers.dev route can be disabled outright, or gated with Access from the
 * dashboard — see README "About the access gate".
 */

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'SAMEORIGIN',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
    ...SECURITY_HEADERS,
  },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/config') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { allow: 'GET, HEAD', ...SECURITY_HEADERS },
        });
      }
      return json({
        name: env.BIDDER_NAME || '',
        icNumber: env.BIDDER_IC || '',
        companyName: env.BIDDER_COMPANY || '',
        companyReg: env.BIDDER_COMPANY_REG || '',
        signatureText: env.SIGNATURE_TEXT || '',
        signatureFont: env.SIGNATURE_FONT || '',
        stampLine2: env.STAMP_LINE2 || '',
        stampBottomText: env.STAMP_BOTTOM_TEXT || '',
      });
    }

    // Anything else under /api/ is a typo, not an asset lookup.
    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'not_found' }, 404);
    }

    const asset = await env.ASSETS.fetch(request);
    // `_headers` is a Pages convention. Re-apply the baseline here so static
    // responses carry it regardless of whether Workers honours that file.
    const headers = new Headers(asset.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    return new Response(asset.body, {
      status: asset.status,
      statusText: asset.statusText,
      headers,
    });
  },
};
