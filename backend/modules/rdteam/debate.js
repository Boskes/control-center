/**
 * Debate Engine
 * Orchestrates the multi-round debate between agents.
 *
 * Round 1: Each agent independently analyzes the context
 * Round 2: Each agent responds to what the others said
 * Round 3: Atlas synthesizes everything into a memo
 */

import { AGENTS, AGENT_ORDER } from './agents.js';
import { callLLM } from './llm.js';

/**
 * Build context string from the user's projects + focus area
 */
function buildContext(session) {
  const { projects, focus, customContext } = session;
  let ctx = `## Current Projects\n`;
  for (const p of (projects || [])) {
    ctx += `- **${p.name}** (port ${p.port || '?'}): ${p.description || 'No description'}\n`;
    if (p.tags?.length) ctx += `  Tags: ${p.tags.join(', ')}\n`;
  }
  if (focus) ctx += `\n## Focus Area\n${focus}\n`;
  if (customContext) ctx += `\n## Additional Context\n${customContext}\n`;
  return ctx;
}

/**
 * Run a full debate session. Calls onProgress(update) for streaming updates.
 */
export async function runDebate(session, onProgress) {
  const steps = [];

  const emit = (step) => {
    steps.push(step);
    onProgress?.(step);
  };

  const context = buildContext(session);

  emit({ type: 'status', message: 'Debat gestart', round: 0 });

  // ── Round 1: Independent Analysis ────────────────────────────
  emit({ type: 'round', round: 1, label: 'Ronde 1 — Onafhankelijke Analyse' });

  const round1 = {};
  for (const agentId of AGENT_ORDER) {
    const agent = AGENTS[agentId];
    emit({ type: 'thinking', agentId, agentName: agent.name, round: 1 });

    const prompt = `Hier is de context over de projecten en situatie die je moet analyseren:\n\n${context}\n\nGeef je onafhankelijke analyse vanuit jouw perspectief (${agent.role}). Antwoord in het Nederlands.`;

    try {
      const response = await callLLM(agent.systemPrompt, prompt, { agentId });
      round1[agentId] = response;
      emit({ type: 'message', agentId, agentName: agent.name, emoji: agent.emoji, role: agent.role, color: agent.color, round: 1, content: response });
    } catch (e) {
      emit({ type: 'error', agentId, message: e.message });
      round1[agentId] = `Error: ${e.message}`;
    }
  }

  // ── Round 2: Debate ───────────────────────────────────────────
  emit({ type: 'round', round: 2, label: 'Ronde 2 — Onderlinge Discussie' });

  const round2 = {};
  for (const agentId of AGENT_ORDER) {
    const agent = AGENTS[agentId];
    emit({ type: 'thinking', agentId, agentName: agent.name, round: 2 });

    // Build summary of what others said in round 1
    const othersOutput = AGENT_ORDER
      .filter(id => id !== agentId)
      .map(id => `**${AGENTS[id].name} (${AGENTS[id].role}):**\n${round1[id]}`)
      .join('\n\n');

    const prompt = `Context:\n${context}\n\nJouw analyse uit Ronde 1:\n${round1[agentId]}\n\nWat je teamgenoten zeiden in Ronde 1:\n${othersOutput}\n\nReageer nu: Ben je het eens of oneens met specifieke punten die zij maakten? Verfijn je standpunt op basis van het debat. Wees direct en specifiek. Antwoord in het Nederlands.`;

    try {
      const response = await callLLM(agent.systemPrompt, prompt, { agentId });
      round2[agentId] = response;
      emit({ type: 'message', agentId, agentName: agent.name, emoji: agent.emoji, role: agent.role, color: agent.color, round: 2, content: response });
    } catch (e) {
      emit({ type: 'error', agentId, message: e.message });
      round2[agentId] = `Error: ${e.message}`;
    }
  }

  // ── Round 3: Atlas writes the memo ────────────────────────────
  emit({ type: 'round', round: 3, label: 'Ronde 3 — Atlas schrijft het memo' });
  emit({ type: 'thinking', agentId: 'atlas', agentName: 'Atlas', round: 3 });

  const fullDebate = AGENT_ORDER.map(id => {
    const a = AGENTS[id];
    return `### ${a.emoji} ${a.name} — ${a.role}\n**Ronde 1:**\n${round1[id]}\n\n**Ronde 2:**\n${round2[id]}`;
  }).join('\n\n---\n\n');

  const atlasPrompt = `Hier is de volledige context:\n${context}\n\nHier is het volledige debat:\n\n${fullDebate}\n\nSchrijf nu het finale strategische memo in het Nederlands.`;

  let memo = '';
  try {
    memo = await callLLM(AGENTS.atlas.systemPrompt, atlasPrompt, { agentId: 'atlas' });
    emit({ type: 'message', agentId: 'atlas', agentName: 'Atlas', emoji: '📋', role: 'The Synthesizer', color: '#38bdf8', round: 3, content: memo });
  } catch (e) {
    emit({ type: 'error', agentId: 'atlas', message: e.message });
    memo = `Error generating memo: ${e.message}`;
  }

  emit({ type: 'complete', memo, rounds: { round1, round2 } });

  return { steps, memo, rounds: { round1, round2 } };
}
