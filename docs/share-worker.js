// GPUscale.net share backend · Cloudflare Worker + KV
// Deploy this when you want SHORT share links (gpuscale.net/?p=abc123) instead
// of the default self-contained links that carry the project inside the URL.
//
// Setup (once, in your Cloudflare account):
//   1. Workers & Pages -> Create Worker -> paste this file.
//   2. Create a KV namespace (e.g. GPUSCALE_SHARES) and bind it to the worker
//      as SHARES (Settings -> Variables -> KV namespace bindings).
//   3. Add a route, e.g. share.gpuscale.net/* (or use the workers.dev URL).
//   4. In assets/app.js set: const SHARE_API='https://share.gpuscale.net';
//      then rebuild dist and deploy the site.
//
// Behavior: POST / with the project JSON body -> {"id":"abc12345"} stored for
// TTL_DAYS. GET /<id> -> the stored JSON. 100 KB cap, CORS limited to the two
// site origins. Anyone with a link can read that one project; nothing else.

const ORIGINS = ['https://gpuscale.net', 'https://mahmoudyassine.github.io'];
const MAX_BYTES = 100 * 1024;
const TTL_DAYS = 180;

function cors(req) {
  const o = req.headers.get('Origin') || '';
  const ok = ORIGINS.some(a => o === a || o.startsWith(a));
  return {
    'Access-Control-Allow-Origin': ok ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function newId() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  const buf = crypto.getRandomValues(new Uint8Array(8));
  for (const b of buf) id += abc[b % abc.length];
  return id;
}

export default {
  async fetch(req, env) {
    const h = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { headers: h });

    if (req.method === 'POST') {
      const body = await req.text();
      if (body.length > MAX_BYTES) return new Response('too large', { status: 413, headers: h });
      try {
        const j = JSON.parse(body);
        if (!j || !/^gpuscale\.net\//.test(j.schema || '')) throw 0;
      } catch (e) { return new Response('not a gpuscale project', { status: 400, headers: h }); }
      const id = newId();
      await env.SHARES.put('p:' + id, body, { expirationTtl: TTL_DAYS * 86400 });
      return new Response(JSON.stringify({ id }), {
        headers: { ...h, 'Content-Type': 'application/json' } });
    }

    if (req.method === 'GET') {
      const id = new URL(req.url).pathname.slice(1);
      if (!/^[a-z2-9]{8}$/.test(id)) return new Response('bad id', { status: 400, headers: h });
      const body = await env.SHARES.get('p:' + id);
      if (!body) return new Response('not found or expired', { status: 404, headers: h });
      return new Response(body, { headers: { ...h, 'Content-Type': 'application/json' } });
    }

    return new Response('method not allowed', { status: 405, headers: h });
  },
};
