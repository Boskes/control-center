/**
 * Module: rdteam
 * ==============
 * R&D Team — AI debate engine met 5 agents.
 * Toegankelijk via: /api/rdteam/...
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { runDebate } from './debate.js';
import { AGENTS } from './agents.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Load .env from control-center root
const envPath = path.join(__dirname, '../../../.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key?.trim() && !key.startsWith('#') && val.length) {
      process.env[key.trim()] = val.join('=').trim();
    }
  });
}

export const name        = 'R&D Team';
export const description = 'AI debate engine — 5 agents analyseren en schrijven een strategisch memo';

export const router = Router();

const DATA_DIR = path.join(__dirname, '../../../data/rdteam');

// Ensure sessions dir exists
if (!fs.existsSync(path.join(DATA_DIR, 'sessions'))) {
  fs.mkdirSync(path.join(DATA_DIR, 'sessions'), { recursive: true });
}

// ── Helpers ───────────────────────────────────────────────────────

function sessionsIndex() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8')); }
  catch { return []; }
}

function saveIndex(idx) {
  fs.writeFileSync(path.join(DATA_DIR, 'index.json'), JSON.stringify(idx, null, 2));
}

function readSession(id) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sessions', `${id}.json`), 'utf8')); }
  catch { return null; }
}

function writeSession(id, data) {
  fs.writeFileSync(path.join(DATA_DIR, 'sessions', `${id}.json`), JSON.stringify(data, null, 2));
}

// ── SSE helper ────────────────────────────────────────────────────
const sseClients = {};

function sendSSE(sessionId, data) {
  const clients = sseClients[sessionId] || [];
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => { try { res.write(msg); } catch {} });
}

// ── Routes ────────────────────────────────────────────────────────

// GET /api/rdteam/agents
router.get('/agents', (_req, res) => res.json(Object.values(AGENTS)));

// GET /api/rdteam/sessions
router.get('/sessions', (_req, res) => {
  const idx = sessionsIndex().sort((a, b) => b.createdAt?.localeCompare(a.createdAt));
  res.json(idx);
});

// GET /api/rdteam/sessions/:id
router.get('/sessions/:id', (req, res) => {
  const s = readSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json(s);
});

// POST /api/rdteam/sessions — start een nieuw debat
router.post('/sessions', async (req, res) => {
  const { focus, customContext, projects } = req.body;

  const id = `session-${Date.now()}`;
  const session = {
    id,
    focus:         focus || 'General strategy review',
    customContext: customContext || '',
    projects:      projects || [],
    status:        'running',
    createdAt:     new Date().toISOString(),
    completedAt:   null,
    memo:          null,
    steps:         [],
  };

  writeSession(id, session);
  const idx = sessionsIndex();
  idx.push({ id, focus: session.focus, status: 'running', createdAt: session.createdAt });
  saveIndex(idx);

  res.status(201).json({ id, status: 'running' });

  (async () => {
    try {
      const result = await runDebate(session, (step) => {
        session.steps.push(step);
        sendSSE(id, step);
        writeSession(id, session);
      });

      session.status      = 'complete';
      session.memo        = result.memo;
      session.completedAt = new Date().toISOString();
      writeSession(id, session);

      const idx2 = sessionsIndex();
      const entry = idx2.find(s => s.id === id);
      if (entry) { entry.status = 'complete'; entry.completedAt = session.completedAt; }
      saveIndex(idx2);

      sendSSE(id, { type: 'done', sessionId: id });
    } catch (e) {
      session.status = 'error';
      session.error  = e.message;
      writeSession(id, session);
      sendSSE(id, { type: 'error', message: e.message });
    }
  })();
});

// GET /api/rdteam/sessions/:id/stream — SSE stream voor live updates
router.get('/sessions/:id/stream', (req, res) => {
  const { id } = req.params;
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const existing = readSession(id);
  if (existing?.steps) {
    for (const step of existing.steps) {
      res.write(`data: ${JSON.stringify(step)}\n\n`);
    }
    if (existing.status === 'complete') {
      res.write(`data: ${JSON.stringify({ type: 'done', sessionId: id })}\n\n`);
    }
  }

  if (!sseClients[id]) sseClients[id] = [];
  sseClients[id].push(res);

  req.on('close', () => {
    sseClients[id] = (sseClients[id] || []).filter(r => r !== res);
  });
});

// GET /api/rdteam/status
router.get('/status', (_req, res) => {
  const sessions  = sessionsIndex();
  const hasKey     = !!process.env.ANTHROPIC_API_KEY;
  const hasGateway = !!process.env.OPENCLAW_GATEWAY_TOKEN;
  res.json({
    ok: true,
    hasApiKey: hasKey || hasGateway,
    mode: (hasKey || hasGateway) ? 'live' : 'mock',
    totalSessions: sessions.length,
    completedSessions: sessions.filter(s => s.status === 'complete').length,
    agents: Object.values(AGENTS).map(a => ({ id: a.id, name: a.name, emoji: a.emoji })),
  });
});
