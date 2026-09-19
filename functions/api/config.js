/**
 * Values that should not be baked into the page bundle.
 *
 * The IC number in particular lives only here, so it is delivered over an
 * authenticated, non-cacheable request instead of being compiled into a JS file
 * that anyone could read.
 *
 * Set these as Pages secrets / environment variables:
 *
 *   APP_PASSWORD        shared password for the whole site (also enables auth)
 *   APP_USER            basic-auth username, defaults to "bidder"
 *   BIDDER_NAME         Koay Hong Vin
 *   BIDDER_IC           970529-02-5353
 *   BIDDER_COMPANY      EDGE INTELLIGENCE SDN. BHD.
 *   BIDDER_COMPANY_REG  202301036017
 *   SIGNATURE_TEXT      HongVin
 *   SIGNATURE_FONT      KaushanScript | Norican | MrDafoe | GreatVibes
 *   STAMP_LINE2         (1529940-V)  — second line inside the stamp
 *   STAMP_BOTTOM_TEXT   optional; replaces the star with arced text
 */

const json = body => new Response(JSON.stringify(body), {
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
    // `public/_headers` only covers static assets, not Functions responses.
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  },
});

export async function onRequestGet({ env }) {
  // Defence in depth: the middleware already blocks this when unset.
  if (!env.APP_PASSWORD) {
    return new Response(JSON.stringify({
      error: 'not_configured',
      message: 'APP_PASSWORD is not set, so this endpoint is switched off.',
    }), {
      status: 503,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
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
