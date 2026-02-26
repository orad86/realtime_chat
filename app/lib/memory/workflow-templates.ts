// ─── Workflow Templates ──────────────────────────────────────
// Learned multi-step tool patterns extracted from Episodic Memory.
// When the agent sees a familiar intent, it can reference the optimal
// tool sequence instead of reasoning from scratch each time.

import { EpisodicMemory, Episode } from "./episodic-memory";

// ─── Types ───────────────────────────────────────────────────

export interface WorkflowTemplate {
  intent: string;                 // e.g. "flight_briefing", "weather_check"
  toolSequence: string[];         // ordered tool names (deduplicated)
  avgToolCount: number;           // average number of tool calls
  avgResponseTime: number;        // average ms
  successRate: number;            // 0-1
  episodeCount: number;           // how many episodes contributed
  lastUsed: number;               // timestamp
  cacheHitRate: number;           // fraction of tool calls that were cache hits
}

// ─── WorkflowTemplateStore ───────────────────────────────────

export class WorkflowTemplateStore {
  private templates = new Map<string, WorkflowTemplate>();

  /** Extract/update workflow templates from episodic memory */
  learnFromEpisodes(episodicMemory: EpisodicMemory): number {
    const episodes = episodicMemory.getAll();
    if (episodes.length === 0) return 0;

    // Group episodes by intent
    const byIntent = new Map<string, Episode[]>();
    for (const ep of episodes) {
      if (ep.toolSequence.length === 0) continue; // skip no-tool episodes
      const existing = byIntent.get(ep.intent) || [];
      existing.push(ep);
      byIntent.set(ep.intent, existing);
    }

    let updated = 0;

    for (const [intent, intentEpisodes] of byIntent) {
      // Need at least 2 episodes to form a template
      if (intentEpisodes.length < 2) continue;

      // Extract the most common tool sequence
      const sequenceFreq = new Map<string, number>();
      for (const ep of intentEpisodes) {
        // Deduplicate consecutive same-tool calls but preserve order
        const deduped = deduplicateSequence(ep.toolSequence.map(a => a.toolName));
        const key = deduped.join(" → ");
        sequenceFreq.set(key, (sequenceFreq.get(key) || 0) + 1);
      }

      // Find most common sequence
      let bestSequence = "";
      let bestCount = 0;
      for (const [seq, count] of sequenceFreq) {
        if (count > bestCount) {
          bestSequence = seq;
          bestCount = count;
        }
      }

      // Calculate aggregate stats
      const successEpisodes = intentEpisodes.filter(ep => ep.outcome === "success");
      const totalToolCalls = intentEpisodes.reduce((sum, ep) => sum + ep.toolSequence.length, 0);
      const totalCachedCalls = intentEpisodes.reduce((sum, ep) =>
        sum + ep.toolSequence.filter(a => a.cached).length, 0
      );

      const template: WorkflowTemplate = {
        intent,
        toolSequence: bestSequence.split(" → "),
        avgToolCount: Math.round(totalToolCalls / intentEpisodes.length),
        avgResponseTime: Math.round(
          intentEpisodes.reduce((sum, ep) => sum + ep.responseTime, 0) / intentEpisodes.length
        ),
        successRate: successEpisodes.length / intentEpisodes.length,
        episodeCount: intentEpisodes.length,
        lastUsed: Math.max(...intentEpisodes.map(ep => ep.endTimestamp)),
        cacheHitRate: totalToolCalls > 0 ? totalCachedCalls / totalToolCalls : 0,
      };

      this.templates.set(intent, template);
      updated++;
    }

    if (updated > 0) {
      console.log(`[workflow-templates] Updated ${updated} templates from ${episodes.length} episodes`);
    }

    return updated;
  }

  /** Get template for a specific intent */
  get(intent: string): WorkflowTemplate | null {
    return this.templates.get(intent) || null;
  }

  /** Get all templates */
  getAll(): WorkflowTemplate[] {
    return Array.from(this.templates.values());
  }

  /** Format for context injection — show relevant workflow patterns */
  formatForContext(currentIntent: string, maxChars: number = 1500): string {
    if (this.templates.size === 0) return "";

    // Prioritize: exact intent match first, then by success rate
    const sorted = Array.from(this.templates.values()).sort((a, b) => {
      if (a.intent === currentIntent && b.intent !== currentIntent) return -1;
      if (b.intent === currentIntent && a.intent !== currentIntent) return 1;
      return b.successRate - a.successRate;
    });

    let output = "═══ LEARNED WORKFLOW PATTERNS ═══\n";
    let chars = output.length;

    for (const tmpl of sorted) {
      const match = tmpl.intent === currentIntent ? " ← CURRENT" : "";
      const cacheStr = tmpl.cacheHitRate > 0
        ? `, ${Math.round(tmpl.cacheHitRate * 100)}% cache hits`
        : "";
      const line = `• ${tmpl.intent}${match}: ${tmpl.toolSequence.join(" → ")} (${tmpl.avgToolCount} tools, ${Math.round(tmpl.successRate * 100)}% success, ~${Math.round(tmpl.avgResponseTime / 1000)}s${cacheStr})\n`;

      if (chars + line.length > maxChars) break;
      output += line;
      chars += line.length;
    }

    return output;
  }

  get size(): number {
    return this.templates.size;
  }
}

// ─── Helpers ─────────────────────────────────────────────────

/** Remove consecutive duplicate tool names while preserving order */
function deduplicateSequence(tools: string[]): string[] {
  const result: string[] = [];
  for (const tool of tools) {
    if (result.length === 0 || result[result.length - 1] !== tool) {
      result.push(tool);
    }
  }
  return result;
}
