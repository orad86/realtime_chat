// ─── Context Assembler ───────────────────────────────────────
// Unified injection point for all memory levels into the system prompt.
// Assembles Working Memory (L1), Episodic Memory (L2), and Semantic Memory (L3)
// into a single coherent context block with token budget management.

import { WorkingMemory } from "./working-memory";
import { EpisodicMemory } from "./episodic-memory";
import { Strategy } from "./types";
import { UserPreferencesStore } from "./user-preferences";
import { WorkflowTemplateStore } from "./workflow-templates";

// ─── Types ───────────────────────────────────────────────────

export interface AssembledContext {
  systemPrompt: string;
  workingMemorySection: string;
  episodicSection: string;
  strategiesSection: string;
  preferencesSection: string;
  workflowSection: string;
  totalInjectedChars: number;
}

export interface ContextBudget {
  working: number;      // chars for Working Memory summary
  episodic: number;     // chars for Episodic Memory summary
  strategies: number;   // chars for Semantic Memory strategies
  preferences: number;  // chars for User Preferences
  workflows: number;    // chars for Workflow Templates
  total: number;        // hard cap for all memory sections combined
}

// ─── Budget Calculation ──────────────────────────────────────

/** Calculate context budget based on query complexity and available data */
function calculateBudget(
  userQuery: string,
  wmSize: number,
  epSize: number,
  strategyCount: number,
  prefSize: number,
  workflowSize: number
): ContextBudget {
  // Base budget: ~14K chars (~3.5K tokens) for all memory sections
  const totalBudget = 14000;

  // If no data, no budget needed
  if (wmSize === 0 && epSize === 0 && strategyCount === 0 && prefSize === 0 && workflowSize === 0) {
    return { working: 0, episodic: 0, strategies: 0, preferences: 0, workflows: 0, total: 0 };
  }

  const hasWm = wmSize > 0;
  const hasEp = epSize > 0;
  const hasStrat = strategyCount > 0;
  const hasPref = prefSize > 0;
  const hasWf = workflowSize > 0;

  // Query-aware weighting: tool-heavy queries get more WM + workflow budget
  const isToolQuery = /\b(brief|weather|metar|nav|route|chart|airport|notam|weight|balance)\b/i.test(userQuery);
  const isCorrection = /\b(fix|correct|change|update|redo|again|still|wrong)\b/i.test(userQuery);

  let wmWeight = hasWm ? 1.0 : 0;
  let epWeight = hasEp ? 1.0 : 0;
  let stratWeight = hasStrat ? 1.0 : 0;
  let prefWeight = hasPref ? 0.4 : 0;
  let wfWeight = hasWf ? 0.5 : 0;

  if (isToolQuery && hasWm) wmWeight = 1.5;
  if (isToolQuery && hasWf) wfWeight = 0.8; // Workflow patterns help tool queries
  if (isCorrection && hasEp) epWeight = 2.0;

  const totalWeight = wmWeight + epWeight + stratWeight + prefWeight + wfWeight;
  if (totalWeight === 0) return { working: 0, episodic: 0, strategies: 0, preferences: 0, workflows: 0, total: 0 };

  return {
    working: Math.round((wmWeight / totalWeight) * totalBudget),
    episodic: Math.round((epWeight / totalWeight) * totalBudget),
    strategies: Math.round((stratWeight / totalWeight) * totalBudget),
    preferences: Math.round((prefWeight / totalWeight) * totalBudget),
    workflows: Math.round((wfWeight / totalWeight) * totalBudget),
    total: totalBudget,
  };
}

// ─── Assembly ────────────────────────────────────────────────

/**
 * Assemble all memory levels into a single context block for system prompt injection.
 * 
 * Order matters for LLM attention:
 * 1. Working Memory (most actionable — what data is cached right now)
 * 2. Episodic Memory (session context — what was done before)
 * 3. Semantic Memory (learned patterns — general strategies)
 */
export async function assembleContext(
  basePrompt: string,
  userQuery: string,
  workingMemory: WorkingMemory,
  episodicMemory: EpisodicMemory,
  strategies: Strategy[],
  strategiesText: string,
  preferencesStore?: UserPreferencesStore,
  workflowStore?: WorkflowTemplateStore,
  currentIntent?: string
): Promise<AssembledContext> {
  const budget = calculateBudget(
    userQuery,
    workingMemory.size,
    episodicMemory.size,
    strategies.length,
    preferencesStore?.size ?? 0,
    workflowStore?.size ?? 0
  );

  // Generate each section within its budget
  const workingMemorySection = budget.working > 0
    ? workingMemory.formatForContext(userQuery, budget.working)
    : "";

  const episodicSection = budget.episodic > 0
    ? episodicMemory.formatForContext(userQuery, budget.episodic)
    : "";

  const strategiesSection = budget.strategies > 0 && strategiesText
    ? formatStrategiesSection(strategiesText, strategies.length, budget.strategies)
    : "";

  const preferencesSection = budget.preferences > 0 && preferencesStore
    ? await preferencesStore.formatForContext(budget.preferences)
    : "";

  const workflowSection = budget.workflows > 0 && workflowStore
    ? workflowStore.formatForContext(currentIntent || "general", budget.workflows)
    : "";

  // Combine all sections — order matters for LLM attention:
  // 1. Preferences (who the user is)
  // 2. Working Memory (what data is cached)
  // 3. Episodic Memory (what was done before)
  // 4. Workflow Templates (learned patterns)
  // 5. Strategies (general knowledge)
  const sections = [preferencesSection, workingMemorySection, episodicSection, workflowSection, strategiesSection]
    .filter(s => s.length > 0);

  let systemPrompt = basePrompt;
  if (sections.length > 0) {
    systemPrompt = `${basePrompt}\n\n${sections.join("\n\n")}`;
  }

  const totalInjectedChars = sections.reduce((sum, s) => sum + s.length, 0);

  if (totalInjectedChars > 0) {
    console.log(`[context-assembler] Injected ${totalInjectedChars} chars: PREF=${preferencesSection.length}, WM=${workingMemorySection.length}, EP=${episodicSection.length}, WF=${workflowSection.length}, STRAT=${strategiesSection.length}`);
  }

  return {
    systemPrompt,
    workingMemorySection,
    episodicSection,
    strategiesSection,
    preferencesSection,
    workflowSection,
    totalInjectedChars,
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function formatStrategiesSection(strategiesText: string, count: number, maxChars: number): string {
  const header = `═══ LEARNED OPERATIONAL STRATEGIES (From ${count} past interactions) ═══\n`;
  const footer = `\nApply these learned strategies when relevant. You can reference that you've learned these patterns from experience.`;

  const available = maxChars - header.length - footer.length;
  const truncatedText = strategiesText.length > available
    ? strategiesText.slice(0, available) + "…"
    : strategiesText;

  return `${header}${truncatedText}${footer}`;
}
