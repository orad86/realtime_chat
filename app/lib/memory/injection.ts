import { Strategy, StrategyBudget, QueryContext, StrategyType } from "./types";
import { CATEGORY_KEYWORDS } from "./constants";
import { getStrategiesByCategory, getSafetyCriticalStrategies } from "./strategies";

// Detect categories from user query
export function detectCategories(query: string): string[] {
  const detected = new Set<string>();
  const lowerQuery = query.toLowerCase();
  
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => lowerQuery.includes(kw))) {
      detected.add(category);
    }
  }
  
  return Array.from(detected);
}

// Calculate dynamic strategy budget based on query complexity
export function calculateStrategyBudget(
  query: string,
  context: QueryContext
): StrategyBudget {
  
  // Base budget
  const budget: StrategyBudget = {
    maxCandidates: 50,
    safetyCriticalSlots: 5,
    regularSlots: 10,
    totalSlots: 15
  };
  
  // Adjust for query complexity
  const wordCount = query.split(/\s+/).length;
  if (wordCount > 50) {
    budget.regularSlots += 5;
    budget.totalSlots += 5;
  }
  
  // Adjust for category
  const categories = detectCategories(query);
  if (categories.includes("safety")) {
    budget.safetyCriticalSlots += 3;
    budget.totalSlots += 3;
  }
  
  // Adjust for token budget
  const availableTokens = context.maxTokens - context.estimatedResponseTokens;
  const tokensPerStrategy = 50; // Rough estimate
  const maxByTokens = Math.floor(availableTokens / tokensPerStrategy);
  
  budget.totalSlots = Math.min(budget.totalSlots, maxByTokens);
  
  // Adjust for conversation context
  if (context.isFollowUp) {
    budget.regularSlots = Math.floor(budget.regularSlots * 0.7);
    budget.totalSlots = budget.safetyCriticalSlots + budget.regularSlots;
  }
  
  return budget;
}

// Score strategies for relevance
async function scoreStrategies(
  candidates: Strategy[],
  userQuery: string,
  budget: StrategyBudget
): Promise<Array<{ strategy: Strategy; score: number }>> {
  
  const lowerQuery = userQuery.toLowerCase();
  
  return candidates.map(strategy => {
    // Base score from confidence
    let score = strategy.confidence * 0.4;
    
    // Add priority weight
    score += (strategy.priority / 10) * 0.3;
    
    // Add relevance score (simple keyword matching)
    const strategyWords = strategy.strategy.toLowerCase().split(/\s+/);
    const queryWords = lowerQuery.split(/\s+/);
    const matchCount = strategyWords.filter(w => queryWords.includes(w)).length;
    const relevance = matchCount / Math.max(strategyWords.length, queryWords.length);
    score += relevance * 0.3;
    
    return { strategy, score };
  });
}

// Select strategies with dynamic budget and relevance filtering
export async function selectStrategiesWithDynamicBudget(
  userQuery: string,
  context: QueryContext
): Promise<Strategy[]> {
  
  // Calculate budget
  const budget = calculateStrategyBudget(userQuery, context);
  
  console.log(`[Memory] Strategy budget: ${budget.totalSlots} total (${budget.safetyCriticalSlots} critical, ${budget.regularSlots} regular)`);
  
  // Detect categories
  const categories = detectCategories(userQuery);
  
  if (categories.length === 0) {
    categories.push("general"); // Default category
  }
  
  console.log(`[Memory] Detected categories: ${categories.join(", ")}`);
  
  // Load candidates from all detected categories
  const candidatePromises = categories.map(cat => 
    getStrategiesByCategory(cat, 0.35, budget.maxCandidates) // Confidence floor filter
  );
  
  const candidateArrays = await Promise.all(candidatePromises);
  const allCandidates = candidateArrays.flat();
  
  // Remove duplicates
  const uniqueCandidates = Array.from(
    new Map(allCandidates.map(s => [s.id, s])).values()
  );
  
  console.log(`[Memory] Loaded ${uniqueCandidates.length} candidate strategies`);
  
  // Score and sort
  const scored = await scoreStrategies(uniqueCandidates, userQuery, budget);
  scored.sort((a, b) => b.score - a.score);
  
  // Filter by relevance threshold
  const relevant = scored.filter(s => s.score > 0.5);
  
  // Separate critical and regular strategies
  const criticalStrategies = relevant
    .filter(s => s.strategy.isCritical)
    .slice(0, budget.safetyCriticalSlots)
    .map(s => s.strategy);
  
  const regularStrategies = relevant
    .filter(s => !s.strategy.isCritical)
    .slice(0, budget.regularSlots)
    .map(s => s.strategy);
  
  // Ensure safety-critical strategies are always included
  const safetyCritical = await getSafetyCriticalStrategies(categories);
  const allCritical = [...new Map(
    [...criticalStrategies, ...safetyCritical].map(s => [s.id, s])
  ).values()].slice(0, budget.safetyCriticalSlots);
  
  // Combine and return
  const selected = [...allCritical, ...regularStrategies].slice(0, budget.totalSlots);
  
  console.log(`[Memory] Selected ${selected.length} strategies (${allCritical.length} critical)`);
  
  return selected;
}

// Format strategies for injection into system prompt
export function formatStrategiesForPrompt(strategies: Strategy[]): string {
  if (strategies.length === 0) {
    return "";
  }
  
  // Group by type for better organization
  const byType = new Map<StrategyType, Strategy[]>();
  
  for (const strategy of strategies) {
    const existing = byType.get(strategy.type) || [];
    existing.push(strategy);
    byType.set(strategy.type, existing);
  }
  
  // Format with priority ordering
  const sections: string[] = [];
  
  // Safety-critical first
  if (byType.has(StrategyType.SAFETY_CRITICAL)) {
    const critical = byType.get(StrategyType.SAFETY_CRITICAL)!;
    sections.push("SAFETY-CRITICAL RULES (Learned from experience - Always apply):");
    critical.forEach((s, i) => {
      sections.push(`${i + 1}. ${s.strategy} [Confidence: ${(s.confidence * 100).toFixed(0)}%]`);
    });
    sections.push("");
  }
  
  // Regulatory
  if (byType.has(StrategyType.REGULATORY)) {
    const regulatory = byType.get(StrategyType.REGULATORY)!;
    sections.push("REGULATORY REQUIREMENTS (Learned from experience):");
    regulatory.forEach((s, i) => {
      sections.push(`${i + 1}. ${s.strategy} [Confidence: ${(s.confidence * 100).toFixed(0)}%]`);
    });
    sections.push("");
  }
  
  // Tool optimization
  if (byType.has(StrategyType.TOOL_OPTIMIZATION)) {
    const tools = byType.get(StrategyType.TOOL_OPTIMIZATION)!;
    sections.push("TOOL USAGE PATTERNS (Learned from experience):");
    tools.forEach((s, i) => {
      sections.push(`${i + 1}. ${s.strategy} [Confidence: ${(s.confidence * 100).toFixed(0)}%]`);
    });
    sections.push("");
  }
  
  // Reasoning heuristics
  if (byType.has(StrategyType.REASONING_HEURISTIC)) {
    const reasoning = byType.get(StrategyType.REASONING_HEURISTIC)!;
    sections.push("REASONING PATTERNS (Learned from experience):");
    reasoning.forEach((s, i) => {
      sections.push(`${i + 1}. ${s.strategy} [Confidence: ${(s.confidence * 100).toFixed(0)}%]`);
    });
    sections.push("");
  }
  
  // Communication
  if (byType.has(StrategyType.COMMUNICATION)) {
    const comm = byType.get(StrategyType.COMMUNICATION)!;
    sections.push("COMMUNICATION GUIDELINES (Learned from experience):");
    comm.forEach((s, i) => {
      sections.push(`${i + 1}. ${s.strategy} [Confidence: ${(s.confidence * 100).toFixed(0)}%]`);
    });
  }
  
  return sections.join("\n");
}

// Get strategy IDs for tracking
export function getStrategyIds(strategies: Strategy[]): string[] {
  return strategies.map(s => s.id);
}
