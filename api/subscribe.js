import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body || {};
  const operator = body.operator || 'unknown';
  const subscription = body.subscription || body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ ok: false, error: 'no subscription' });
  }

  const key = `push_subs:${operator}`;
  const existing = (await redis.get(key)) || {};
  const subs = typeof existing === 'string' ? JSON.parse(existing) : existing;
  subs[subscription.endpoint] = subscription;
  await redis.set(key, JSON.stringify(subs));

  res.status(200).json({ ok: true, operator, devices: Object.keys(subs).length });
}
