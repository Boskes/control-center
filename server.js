/**
 * Mike Control Center — Central Hub Server
 * ==========================================
 * Modular, plugin-based architecture.
 * Each module (route) lives in /modules/ and is auto-loaded.
 *
 * Port: 3002
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Data helpers ──────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');

export function readData(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    return null;
  }
}

export function writeData(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// ── Auto-load modules ─────────────────────────────────────────────────────────
const MODULES_DIR = path.join(__dirname, 'modules');
const loadedModules = [];

async function loadModules() {
  if (!fs.existsSync(MODULES_DIR)) {
    console.log('  ⚠️  No modules directory found, skipping module loading.');
    return;
  }

  const entries = fs.readdirSync(MODULES_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const indexPath = path.join(MODULES_DIR, entry.name, 'index.js');
    if (!fs.existsSync(indexPath)) continue;

    try {
      const mod = await import(`./modules/${entry.name}/index.js`);

      // Each module exports: { name, description, router }
      if (mod.router) {
        const prefix = `/api/${entry.name}`;
        app.use(prefix, mod.router);
        loadedModules.push({
          id: entry.name,
          name: mod.name || entry.name,
          description: mod.description || '',
          prefix,
        });
        console.log(`  ✅ Module loaded: ${entry.name} → ${prefix}`);
      }
    } catch (err) {
      console.warn(`  ❌ Failed to load module "${entry.name}":`, err.message);
    }
  }
}

// ── Core API routes ───────────────────────────────────────────────────────────

// GET /api/status — health check + loaded modules
app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    version: '2.0.0',
    uptime: Math.floor(process.uptime()),
    modules: loadedModules,
    timestamp: new Date().toISOString(),
  });
});

// ── Projects module (built-in) ────────────────────────────────────────────────

app.get('/api/projects', (_req, res) => {
  const data = readData('projects.json');
  res.json(data?.projects ?? []);
});

app.get('/api/projects/:id', (req, res) => {
  const data = readData('projects.json');
  const project = data?.projects?.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

app.post('/api/projects', (req, res) => {
  const data = readData('projects.json') || { version: 1, projects: [] };
  const { name, description, icon, url, port, tags, meta } = req.body;

  if (!name) return res.status(400).json({ error: 'name is required' });

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (data.projects.find(p => p.id === id)) {
    return res.status(409).json({ error: `Project "${id}" already exists` });
  }

  const project = {
    id,
    name,
    description: description || '',
    icon: icon || '📦',
    status: 'active',
    url: url || null,
    port: port || null,
    tags: tags || [],
    createdAt: new Date().toISOString(),
    meta: meta || {},
  };

  data.projects.push(project);
  writeData('projects.json', data);
  res.status(201).json(project);
});

app.put('/api/projects/:id', (req, res) => {
  const data = readData('projects.json');
  const idx = data?.projects?.findIndex(p => p.id === req.params.id);
  if (idx === -1 || idx === undefined) return res.status(404).json({ error: 'Project not found' });

  data.projects[idx] = { ...data.projects[idx], ...req.body, id: data.projects[idx].id };
  writeData('projects.json', data);
  res.json(data.projects[idx]);
});

app.delete('/api/projects/:id', (req, res) => {
  const data = readData('projects.json');
  const before = data?.projects?.length ?? 0;
  data.projects = data.projects.filter(p => p.id !== req.params.id);
  if (data.projects.length === before) return res.status(404).json({ error: 'Project not found' });
  writeData('projects.json', data);
  res.json({ ok: true });
});

// ── Workflows module (built-in) ───────────────────────────────────────────────

app.get('/api/workflows', (_req, res) => {
  const data = readData('workflows.json');
  res.json(data?.workflows ?? []);
});

app.post('/api/workflows', (req, res) => {
  const data = readData('workflows.json') || { version: 1, workflows: [] };
  const { name, projectId, trigger, steps, enabled } = req.body;

  if (!name || !projectId) return res.status(400).json({ error: 'name and projectId are required' });

  const workflow = {
    id: `wf-${Date.now()}`,
    name,
    projectId,
    trigger: trigger || 'manual',
    steps: steps || [],
    enabled: enabled !== false,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    runs: [],
  };

  data.workflows.push(workflow);
  writeData('workflows.json', data);
  res.status(201).json(workflow);
});

app.delete('/api/workflows/:id', (req, res) => {
  const data = readData('workflows.json');
  data.workflows = data.workflows.filter(w => w.id !== req.params.id);
  writeData('workflows.json', data);
  res.json({ ok: true });
});

// ── OpenClaw Agents API ───────────────────────────────────────────────────────
app.get('/api/openclaw/agents', (_req, res) => {
  try {
    const configPath = path.join(
      process.env.USERPROFILE || process.env.HOME,
      '.openclaw', 'openclaw.json'
    );
    const raw  = fs.readFileSync(configPath, 'utf8');
    // JSON5-like: strip comments, handle trailing commas
    const clean = raw
      .replace(/\/\/.*$/gm, '')           // strip // comments
      .replace(/,(\s*[}\]])/g, '$1');     // strip trailing commas
    const config = JSON.parse(clean);
    const agents = config?.agents?.list || [];

    // Enrich with status
    const enriched = agents.map(a => ({
      id:          a.id,
      name:        a.name || a.id,
      emoji:       a.identity?.emoji || '🤖',
      model:       a.model?.primary || config?.agents?.defaults?.model?.primary || 'default',
      workspace:   a.workspace || config?.agents?.defaults?.workspace || '',
      tools:       a.tools?.profile || 'full',
      description: a.identity?.description || null,
    }));

    res.json({ agents: enriched, total: enriched.length });
  } catch (e) {
    res.status(500).json({ error: e.message, agents: [] });
  }
});

// ── Catch-all → SPA ──────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Boot ──────────────────────────────────────────────────────────────────────
await loadModules();

app.listen(PORT, () => {
  console.log(`\n🤖 Mike Control Center v2.0.0`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Modules loaded: ${loadedModules.length}\n`);
});
