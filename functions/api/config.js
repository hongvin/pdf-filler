/**
 * Values that should not be baked into the page bundle.
 *
 * The IC number in particular lives only here, so it is delivered over a
 * non-cacheable request instead of being compiled into a JS file.
 *
 * NOTE: this endpoint is public. The site no longer sits behind HTTP Basic
 * auth (see README "About the access gate"), so anyone with the URL can read
 * the response. That is a deliberate choice for a personal single-user tool —
 * do not add more sensitive values here without putting the gate back.
 *
 * Set these as Pages secrets / environment variables:
 *
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
