import { OutcomeSignal, OutcomeType, Strategy } from "./types";
import { CONFIDENCE_CONFIG, OUTCOME_WEIGHTS, STRATEGY_RULES } from "./constants";
import { getStrategy, updateStrategyConfidence, archiveStrategy, flagStrategyForReview } from "./strategies";

// Update strategy confidence with momentum dampening
export async function updateConfidenceWithMomentum(
  strategyId: string,
  outcome: OutcomeSignal
): Promise<void> {
  
  const strategy = await getStrategy(strategyId);
  if (!strategy) {
    console.warn(`[Memory] Strategy ${strategyId} not found for confidence update`);
    return;
  }
  
  const config = CONFIDENCE_CONFIG[strategy.type];
  
  // Calculate base adjustment
  let adjustment = OUTCOME_WEIGHTS[outcome.signalType] * config.learningRate;
  
  // Apply safety multiplier for negative outcomes
  if (adjustment < 0 && outcome.signalType.includes("safety")) {
    adjustment *= config.safetyMultiplier;
  }
  
  // Apply nonlinear penalty curve - high confidence strategies resist noise
  // Low confidence strategies adapt quickly
  const adaptationRate = 1 - (strategy.confidence * 0.7);
  adjustment *= adaptationRate;
  
  // Apply momentum dampening
  const observedConfidence = strategy.confidence + adjustment;
  const newConfidence = 
    strategy.confidence * config.momentum +
    observedConfidence * (1 - config.momentum);
  
  // Clamp to [0, 1]
  const clampedConfidence = Math.max(0, Math.min(1, newConfidence));
  
  // Update outcome counters
  const positiveOutcomes = adjustment > 0 
    ? strategy.positiveOutcomes + 1 
    : strategy.positiveOutcomes;
  const negativeOutcomes = adjustment < 0 
    ? strategy.negativeOutcomes + 1 
    : strategy.negativeOutcomes;
  const appliedCount = strategy.appliedCount + 1;
  
  // Calculate success rate
  const totalOutcomes = positiveOutcomes + negativeOutcomes;
  const successRate = totalOutcomes > 0 
    ? positiveOutcomes / totalOutcomes 
    : strategy.successRate;
  
  // Update strategy
  await updateStrategyConfidence(
    strategyId,
    clampedConfidence,
    successRate,
    positiveOutcomes,
    negativeOutcomes,
    appliedCount
  );
  
  // Check for removal threshold
  const typeRules = STRATEGY_RULES[strategy.type];
  if (clampedConfidence < typeRules.minConfidence) {
    if (strategy.isCritical) {
      await flagStrategyForReview(strategyId, "confidence_below_threshold");
    } else {
      await archiveStrategy(strategyId, "low_confidence");
    }
  }
  
  // Special handling for safety violations
  if (outcome.signalType === OutcomeType.SAFETY_VIOLATION) {
    await flagStrategyForReview(strategyId, "safety_violation_detected");
  }
}

// Detect outcomes from interaction patterns
export async function detectOutcomes(
  interaction: any,
  appliedStrategies: string[]
): Promise<OutcomeSignal[]> {
  
  const signals: OutcomeSignal[] = [];
  const timestamp = Date.now();
  
  // 1. Tool success/failure signals
  for (const toolResult of interaction.toolResults || []) {
    const relatedStrategy = findStrategyForTool(appliedStrategies, toolResult.toolName);
    
    if (relatedStrategy) {
      signals.push({
        strategyId: relatedStrategy,
        interactionId: interaction.id,
        signalType: toolResult.success ? OutcomeType.TOOL_SUCCESS : OutcomeType.TOOL_FAILURE,
        weight: toolResult.success ? 0.03 : -0.05,
        timestamp
      });
    }
  }
  
  // 2. User correction detection (heuristic)
  // This is a simple implementation - could be enhanced with GPT analysis
  const correctionKeywords = ["actually", "no", "wrong", "incorrect", "that's not", "mistake"];
  const userMessage = interaction.userMessage?.toLowerCase() || "";
  
  if (correctionKeywords.some(kw => userMessage.includes(kw))) {
    // Apply to most recently used strategy
    if (appliedStrategies.length > 0) {
      signals.push({
        strategyId: appliedStrategies[0],
        interactionId: interaction.id,
        signalType: OutcomeType.USER_CORRECTED,
        weight: -0.10,
        timestamp
      });
    }
  }
  
  // 3. Default positive signal if no correction detected
  // This assumes user acceptance if they don't correct
  if (signals.length === 0 && appliedStrategies.length > 0) {
    signals.push({
      strategyId: appliedStrategies[0],
      interactionId: interaction.id,
      signalType: OutcomeType.USER_ACCEPTED,
      weight: 0.05,
      timestamp
    });
  }
  
  return signals;
}

// Helper to find strategy related to a tool
function findStrategyForTool(strategyIds: string[], toolName: string): string | null {
  // This is a simple implementation
  // In production, you'd want to track which strategy recommended which tool
  // For now, return the first strategy if any tools were used
  return strategyIds.length > 0 ? strategyIds[0] : null;
}

// Batch update confidences for multiple outcomes
export async function batchUpdateConfidences(outcomes: OutcomeSignal[]): Promise<void> {
  console.log(`[Memory] Batch updating confidences for ${outcomes.length} outcomes`);
  
  // Group outcomes by strategy to avoid multiple updates to same strategy
  const outcomesByStrategy = new Map<string, OutcomeSignal[]>();
  
  for (const outcome of outcomes) {
    const existing = outcomesByStrategy.get(outcome.strategyId) || [];
    existing.push(outcome);
    outcomesByStrategy.set(outcome.strategyId, existing);
  }
  
  // Process each strategy's outcomes
  for (const [strategyId, strategyOutcomes] of outcomesByStrategy) {
    // Apply most recent outcome (or aggregate if multiple)
    const latestOutcome = strategyOutcomes[strategyOutcomes.length - 1];
    
    try {
      await updateConfidenceWithMomentum(strategyId, latestOutcome);
    } catch (error) {
      console.error(`[Memory] Failed to update confidence for strategy ${strategyId}:`, error);
    }
  }
  
  console.log(`[Memory] Completed batch confidence updates`);
}
