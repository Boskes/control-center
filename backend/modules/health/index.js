/**
 * Module: health
 * ==============
 * Example module that pings other services and reports their health.
 * Accessible at: GET /api/health/check
 *
 * To create your own module:
 *   1. Create a folder under control-center/modules/<your-module>/
 *   2. Export: name, description, router
 *   3. The server auto-loads it on startup
 */

import { Router } from 'express';

export const name        = 'Health Monitor';
export const description = 'Checks health of all registered project URLs';

export const router = Router();

// GET /api/health/check  — ping all known services
router.get('/check', async (req, res) => {
  const services = [
    { name: 'Activity Dashboard',       url: 'http://localhost:3001' },
    { name: 'GarageOS',                 url: 'http://localhost:3002' },
    { name: 'YouTube Transcript Tool',  url: 'http://localhost:3003' },
  ];

  const results = await Promise.all(
    services.map(async svc => {
      const start = Date.now();
      try {
        const r = await fetch(svc.url, { signal: AbortSignal.timeout(3000) });
        return { name: svc.name, url: svc.url, status: r.ok ? 'up' : 'degraded', ms: Date.now() - start };
      } catch {
        return { name: svc.name, url: svc.url, status: 'down', ms: null };
      }
    })
  );

  res.json({
    checkedAt: new Date().toISOString(),
    services: results,
    summary: {
      up:       results.filter(r => r.status === 'up').length,
      degraded: results.filter(r => r.status === 'degraded').length,
      down:     results.filter(r => r.status === 'down').length,
    },
  });
});
