import { Redis } from '@upstash/redis';
import webpush from 'web-push';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

webpush.setVapidDetails(
  'mailto:masuyuta0401@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { title, body, to, dedupeKey, ttl } = req.body || {};
  const targets = Array.isArray(to) && to.length ? to.filter(Boolean) : [];
  if (!targets.length) return res.status(200).json({ ok: true, sent: 0, skipped: 'no targets' });

  if (dedupeKey) {
    const got = await redis.set(`notified:${dedupeKey}`, '1', {
      nx: true,
      ex: Math.max(60, Number(ttl) || 3600),
    });
    if (!got) return res.status(200).json({ ok: true, sent: 0, skipped: 'duplicate' });
  }

  const payload = JSON.stringify({
    title: title || '千隼くん',
    body: body || '記録の時間です',
  });
  let sent = 0, failed = 0;

  for (const op of targets) {
    const key = `push_subs:${op}`;
    const raw = await redis.get(key);
    if (!raw) continue;
    const subs = typeof raw === 'string' ? JSON.parse(raw) : raw;
    let changed = false;
    for (const [endpoint, sub] of Object.entries(subs)) {
      try {
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (e) {
        failed++;
        if (e.statusCode === 404 || e.statusCode === 410) {
          delete subs[endpoint];
          changed = true;
        }
      }
    }
    if (changed) await redis.set(key, JSON.stringify(subs));
  }

  res.status(200).json({ ok: true, sent, failed });
}
