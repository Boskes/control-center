/**
 * Module: trends
 * ==============
 * Trend Tracker — pollt Reddit & YouTube voor trending content.
 * Toegankelijk via: /api/trends/...
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { searchReddit, searchRedditPublic } from './reddit.js';
import { searchYouTube } from './youtube.js';
import { TOPICS, THRESHOLDS, POLL_INTERVAL } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Load .env from control-center root
const envPath = path.join(__dirname, '../../../.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#') && val.length) {
      process.env[key.trim()] = val.join('=').trim();
    }
  });
}

export const name        = 'Trend Tracker';
export const description = 'Pollt Reddit & YouTube voor trending AI-content';

export const router = Router();

const DATA_DIR = path.join(__dirname, '../../../data/trends');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Data helpers ──────────────────────────────────────────────────

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

function initData() {
  if (!readJSON('results.json', null)) writeJSON('results.json', { updatedAt: null, topics: {} });
  if (!readJSON('alerts.json',  null)) writeJSON('alerts.json',  { alerts: [] });
  if (!readJSON('settings.json', null)) writeJSON('settings.json', {
    reddit:  { enabled: true,  upvotes: THRESHOLDS.reddit.upvotes,  comments: THRESHOLDS.reddit.comments },
    youtube: { enabled: true,  views:   THRESHOLDS.youtube.views,   likes:    THRESHOLDS.youtube.likes   },
    pollIntervalMinutes: POLL_INTERVAL,
  });
}

// ── Polling engine ────────────────────────────────────────────────

let isPolling = false;
let lastPoll  = null;
let pollStatus = 'idle';

async function pollAll() {
  if (isPolling) return;
  isPolling   = true;
  pollStatus  = 'polling';
  console.log(`\n🔄 [Trends] [${new Date().toISOString()}] Polling started…`);

  const settings = readJSON('settings.json', {});
  const results  = readJSON('results.json', { topics: {} });
  const alertsData = readJSON('alerts.json', { alerts: [] });
  const newAlerts  = [];

  for (const topic of TOPICS) {
    const topicResults = { reddit: [], youtube: [] };

    // ── Reddit ──
    if (settings.reddit?.enabled !== false) {
      try {
        let posts;
        const hasAuth = process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET;
        if (hasAuth) {
          posts = await searchReddit(topic.keywords[0], topic.subreddits);
        } else {
          const sub = topic.subreddits[0] || 'artificial';
          posts = await searchRedditPublic(topic.keywords[0], sub);
        }

        topicResults.reddit = posts.slice(0, 15);

        for (const post of topicResults.reddit) {
          const alreadyAlerted = alertsData.alerts.some(a => a.id === `reddit-${post.id}`);
          if (!alreadyAlerted) {
            const hitUpvotes  = post.upvotes  >= (settings.reddit?.upvotes  || 50);
            const hitComments = post.comments >= (settings.reddit?.comments || 20);
            if (hitUpvotes || hitComments) {
              const alert = {
                id: `reddit-${post.id}`, type: 'reddit', topicId: topic.id, topicLabel: topic.label,
                title: post.title, url: post.url,
                metric: hitUpvotes ? `${post.upvotes} upvotes` : `${post.comments} comments`,
                value: hitUpvotes ? post.upvotes : post.comments,
                timestamp: new Date().toISOString(), seen: false,
              };
              newAlerts.push(alert);
            }
          }
        }
        console.log(`  ✅ [Trends] Reddit [${topic.label}]: ${posts.length} posts`);
      } catch (e) {
        console.warn(`  ⚠️  [Trends] Reddit [${topic.label}] error:`, e.message);
      }
    }

    // ── YouTube ──
    if (settings.youtube?.enabled !== false && process.env.YOUTUBE_API_KEY) {
      try {
        const videos = await searchYouTube(topic.youtubeQuery);
        topicResults.youtube = videos.slice(0, 10);

        for (const video of topicResults.youtube) {
          const alreadyAlerted = alertsData.alerts.some(a => a.id === `yt-${video.id}`);
          if (!alreadyAlerted) {
            const hitViews = video.views >= (settings.youtube?.views || 1000);
            const hitLikes = video.likes >= (settings.youtube?.likes || 50);
            if (hitViews || hitLikes) {
              const alert = {
                id: `yt-${video.id}`, type: 'youtube', topicId: topic.id, topicLabel: topic.label,
                title: video.title, url: video.url,
                metric: hitViews ? `${video.views.toLocaleString()} views` : `${video.likes} likes`,
                value: hitViews ? video.views : video.likes,
                timestamp: new Date().toISOString(), seen: false,
              };
              newAlerts.push(alert);
            }
          }
        }
        console.log(`  ✅ [Trends] YouTube [${topic.label}]: ${videos.length} videos`);
      } catch (e) {
        console.warn(`  ⚠️  [Trends] YouTube [${topic.label}] error:`, e.message);
      }
    }

    results.topics[topic.id] = topicResults;
  }

  results.updatedAt = new Date().toISOString();
  writeJSON('results.json', results);

  if (newAlerts.length) {
    alertsData.alerts = [...newAlerts, ...alertsData.alerts].slice(0, 200);
    writeJSON('alerts.json', alertsData);
  }

  lastPoll   = new Date().toISOString();
  pollStatus = 'ok';
  isPolling  = false;
  console.log(`✅ [Trends] Poll complete. ${newAlerts.length} new alert(s).\n`);
}

// ── Scheduler ─────────────────────────────────────────────────────

function startScheduler() {
  const settings = readJSON('settings.json', { pollIntervalMinutes: POLL_INTERVAL });
  const interval = settings.pollIntervalMinutes || POLL_INTERVAL;
  const expr = `*/${interval} * * * *`;
  cron.schedule(expr, () => pollAll());
  console.log(`⏰ [Trends] Scheduler: polling every ${interval} minutes`);
}

// ── Init ──────────────────────────────────────────────────────────
initData();
startScheduler();
setTimeout(() => pollAll(), 5000);

// ── API Routes ────────────────────────────────────────────────────

// GET /api/trends/status (hernoem van /api/status om conflict te vermijden)
router.get('/status', (_req, res) => {
  const settings = readJSON('settings.json', {});
  const alerts   = readJSON('alerts.json', { alerts: [] });
  const unseen   = alerts.alerts.filter(a => !a.seen).length;
  res.json({
    pollStatus, lastPoll, isPolling,
    topicsCount: TOPICS.length,
    unseenAlerts: unseen,
    hasRedditAuth:  !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET),
    hasYouTubeAuth: !!process.env.YOUTUBE_API_KEY,
    settings,
  });
});

// GET /api/trends/results
router.get('/results', (_req, res) => {
  res.json(readJSON('results.json', { updatedAt: null, topics: {} }));
});

// GET /api/trends/results/:topicId
router.get('/results/:topicId', (req, res) => {
  const data = readJSON('results.json', { topics: {} });
  const topic = TOPICS.find(t => t.id === req.params.topicId);
  if (!topic) return res.status(404).json({ error: 'Topic not found' });
  res.json({ topic, results: data.topics[req.params.topicId] || { reddit: [], youtube: [] } });
});

// GET /api/trends/topics
router.get('/topics', (_req, res) => res.json(TOPICS));

// GET /api/trends/alerts
router.get('/alerts', (_req, res) => {
  const data = readJSON('alerts.json', { alerts: [] });
  res.json(data.alerts);
});

// POST /api/trends/alerts/seen
router.post('/alerts/seen', (_req, res) => {
  const data = readJSON('alerts.json', { alerts: [] });
  data.alerts = data.alerts.map(a => ({ ...a, seen: true }));
  writeJSON('alerts.json', data);
  res.json({ ok: true });
});

// DELETE /api/trends/alerts/:id
router.delete('/alerts/:id', (req, res) => {
  const data = readJSON('alerts.json', { alerts: [] });
  data.alerts = data.alerts.filter(a => a.id !== req.params.id);
  writeJSON('alerts.json', data);
  res.json({ ok: true });
});

// GET /api/trends/settings
router.get('/settings', (_req, res) => {
  res.json(readJSON('settings.json', {}));
});

// PUT /api/trends/settings
router.put('/settings', (req, res) => {
  writeJSON('settings.json', req.body);
  res.json({ ok: true });
});

// POST /api/trends/poll
router.post('/poll', (_req, res) => {
  if (isPolling) return res.json({ ok: false, message: 'Already polling' });
  pollAll();
  res.json({ ok: true, message: 'Poll started' });
});
