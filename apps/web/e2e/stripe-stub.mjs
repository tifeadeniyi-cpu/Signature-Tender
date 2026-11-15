// A local stand-in for the few Stripe endpoints the app calls, used only by the e2e tests (the test
// container cannot reach api.stripe.com). Its "checkout page" sends a properly signed webhook to the
// app, exactly as Stripe would, then redirects back. The app's own code path is unchanged.
import http from 'node:http';
import Stripe from 'stripe';

const PORT = Number(process.env.STRIPE_STUB_PORT ?? 12111);
const APP = process.env.APP_URL ?? 'http://localhost:3100';
const SECRET = process.env.STRIPE_WEBHOOK_SECRET;
if (!SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is required');
const signer = new Stripe('sk_test_stub');

const sessions = new Map();
let seq = 0;
const next = (p) => `${p}${Date.now().toString(36)}${++seq}`;

function read(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(new URLSearchParams(body)));
  });
}
function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function sendEvent(type, object) {
  const payload = JSON.stringify({
    id: next('evt_stub_'),
    object: 'event',
    api_version: '2026-10-28.endive',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: { object },
  });
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const r = await fetch(`${APP}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    body: payload,
  });
  if (!r.ok) throw new Error(`webhook ${type} failed: ${r.status} ${await r.text()}`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });

    if (req.method === 'POST' && url.pathname === '/v1/customers') {
      const p = await read(req);
      return json(res, 200, { id: next('cus_stub'), object: 'customer', name: p.get('name') });
    }

    if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const p = await read(req);
      const id = next('cs_test_stub_');
      const s = {
        id,
        mode: p.get('mode'),
        amount: Number(p.get('line_items[0][price_data][unit_amount]')),
        currency: p.get('line_items[0][price_data][currency]'),
        name: p.get('line_items[0][price_data][product_data][name]'),
        customer: p.get('customer'),
        customerEmail: p.get('customer_email'),
        metadata: Object.fromEntries(
          [...p.entries()]
            .filter(([k]) => /^metadata\[\w+\]$/.test(k))
            .map(([k, v]) => [k.slice(9, -1), v]),
        ),
        success: p.get('success_url'),
        cancel: p.get('cancel_url'),
      };
      sessions.set(id, s);
      return json(res, 200, {
        id,
        object: 'checkout.session',
        mode: s.mode,
        url: `http://localhost:${PORT}/pay/${id}`,
      });
    }

    // Setup-mode checkout saves a card: the app reads it back from the SetupIntent.
    const si = url.pathname.match(/^\/v1\/setup_intents\/(seti_[\w]+)$/);
    if (req.method === 'GET' && si)
      return json(res, 200, {
        id: si[1],
        object: 'setup_intent',
        status: 'succeeded',
        payment_method: {
          id: `pm_${si[1].slice(5)}`,
          object: 'payment_method',
          card: { brand: 'visa', last4: '4242' },
        },
      });
    if (req.method === 'POST' && /^\/v1\/customers\/cus_[\w]+$/.test(url.pathname))
      return json(res, 200, { id: url.pathname.split('/').pop(), object: 'customer' });

    if (req.method === 'POST' && url.pathname === '/v1/refunds') {
      const p = await read(req);
      return json(res, 200, {
        id: next('re_stub'),
        object: 'refund',
        payment_intent: p.get('payment_intent'),
        status: 'succeeded',
      });
    }

    if (req.method === 'POST' && url.pathname === '/v1/billing_portal/sessions')
      return json(res, 200, { id: next('bps_'), url: `http://localhost:${PORT}/portal` });

    const m = url.pathname.match(/^\/pay\/(cs_[\w]+)$/);
    if (m && sessions.has(m[1])) {
      const s = sessions.get(m[1]);
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(`<!doctype html><title>Test checkout</title><main>
          <h1>Test checkout (local Stripe stand-in)</h1>
          <p>${s.mode === 'setup' ? 'Save a card' : `${s.name}: ${(s.amount / 100).toFixed(2)} ${s.currency.toUpperCase()}`}</p>
          <form method="post"><button>Pay</button></form>
          <a href="${s.cancel}">Cancel</a></main>`);
      }
      await sendEvent('checkout.session.completed', {
        id: s.id,
        object: 'checkout.session',
        mode: s.mode,
        payment_status: s.mode === 'setup' ? 'no_payment_required' : 'paid',
        status: 'complete',
        amount_subtotal: s.amount,
        amount_total: s.amount,
        currency: s.currency,
        customer: s.customer,
        payment_intent: s.mode === 'payment' ? `pi_${s.id}` : null,
        subscription: s.mode === 'subscription' ? next('sub_stub_') : null,
        setup_intent: s.mode === 'setup' ? next('seti_stub') : null,
        invoice: null,
        customer_details: s.customerEmail ? { email: s.customerEmail } : null,
        metadata: s.metadata,
      });
      res.writeHead(303, { location: s.success.replace('{CHECKOUT_SESSION_ID}', s.id) });
      return res.end();
    }
    json(res, 404, { error: { message: `stub has no route for ${req.method} ${url.pathname}` } });
  } catch (err) {
    json(res, 500, { error: { message: String(err) } });
  }
});
server.listen(PORT, () => console.log(`Stripe stand-in on ${PORT}`));
