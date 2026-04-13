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

  const { title, body } = req.body;

  const sub = await redis.get('push_subscription');
  if (!sub) return res.status(404).json({ ok: false, error: 'No subscription' });

  const subscription = typeof sub === 'string' ? JSON.parse(sub) : sub;

  await webpush.sendNotification(
    subscription,
    JSON.stringify({ title: title || 'ふくちゃん', body: body || '記録の時間です' })
  );

  res.status(200).json({ ok: true });
}
