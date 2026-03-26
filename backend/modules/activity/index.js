/**
 * Module: activity
 * ================
 * Activity Dashboard — logt werk activiteiten van Mike.
 * Toegankelijk via: GET/POST /api/activity
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export const name        = 'Activity Dashboard';
export const description = 'Logt werk activiteiten';

export const router = Router();

const LOG_FILE = path.join(__dirname, '../../../data/activity-log.json');

function readLog() {
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  } catch {
    return { version: 1, entries: [] };
  }
}

function writeLog(data) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(data, null, 2));
}

// GET /api/activity — alle entries (optioneel filter op project)
router.get('/', (req, res) => {
  const { project, limit = 100 } = req.query;
  const log = readLog();
  let entries = log.entries.slice().reverse(); // newest first
  if (project && project !== 'all') {
    entries = entries.filter(e => e.project === project);
  }
  entries = entries.slice(0, parseInt(limit));

  const projects = [...new Set(log.entries.map(e => e.project).filter(Boolean))];

  const projectCounts = {};
  log.entries.forEach(e => {
    if (e.project) projectCounts[e.project] = (projectCounts[e.project] || 0) + 1;
  });

  res.json({ entries, projects, projectCounts, total: log.entries.length });
});

// POST /api/activity — nieuwe entry toevoegen
router.post('/', (req, res) => {
  const log = readLog();
  const entry = {
    id: String(log.entries.length + 1).padStart(3, '0'),
    timestamp: new Date().toISOString(),
    ...req.body,
  };
  log.entries.push(entry);
  writeLog(log);
  res.json({ ok: true, entry });
});
