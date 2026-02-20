// Core types for the memory system

export enum StrategyType {
  SAFETY_CRITICAL = "safety_critical",
  REGULATORY = "regulatory",
  TOOL_OPTIMIZATION = "tool_optimization",
  REASONING_HEURISTIC = "reasoning_heuristic",
  COMMUNICATION = "communication",
  EXPERIMENTAL = "experimental"
}

export enum SafetyRating {
  CRITICAL = "CRITICAL",
  SAFE = "SAFE",
  UNSAFE = "UNSAFE"
}

export enum StrategyStatus {
  ACTIVE = "active",
  ARCHIVED = "archived",
  FLAGGED = "flagged",
  SUPERSEDED = "superseded"
}

export enum ConflictType {
  DIRECT_OPPOSITE = "direct_opposite",
  OVERLAPPING = "overlapping",
  CONTRADICTORY_CONDITIONS = "contradictory_conditions"
}

export enum ConflictSeverity {
  CRITICAL = "critical",
  MODERATE = "moderate",
  MINOR = "minor"
}

export enum ResolutionAction {
  REJECT_NEW = "reject_new",
  REPLACE_EXISTING = "replace_existing",
  FLAG_FOR_REVIEW = "flag_for_review",
  RESOLVED = "resolved"
}

export enum OutcomeType {
  // Positive signals
  USER_ACCEPTED = "user_accepted",
  TOOL_SUCCESS = "tool_success",
  NO_CORRECTION = "no_correction",
  FOLLOW_UP_QUESTION = "follow_up_question",
  
  // Negative signals
  USER_CORRECTED = "user_corrected",
  TOOL_FAILURE = "tool_failure",
  CONTRADICTION = "contradiction",
  SAFETY_VIOLATION = "safety_violation",
  
  // Neutral
  NOT_APPLIED = "not_applied"
}

export interface Strategy {
  id: string;
  version: number;
  strategy: string;
  category: string;
  type: StrategyType;
  priority: number;
  isCritical: boolean;
  
  // Validation metadata
  safetyRating: SafetyRating;
  regulatoryBasis?: string;
  validatedAt: number;
  validatedBy: string;
  
  // Performance tracking
  confidence: number;
  appliedCount: number;
  positiveOutcomes: number;
  negativeOutcomes: number;
  successRate: number;
  
  // Conflict tracking
  conflictsWith: string[];
  supersedes?: string;
  
  // Metadata
  sourceInteractionIds: string[];
  createdAt: number;
  lastUsed: number;
  expiresAt?: number;
  tags: string[];
  status: StrategyStatus;
}

export interface Interaction {
  id: string;
  sessionId: string;
  userMessage: string;
  agentResponse: string;
  responseChunks?: string[];
  toolsUsed: string[];
  toolResults: ToolResult[];
  appliedStrategies: string[];
  timestamp: number;
  processed: boolean;
  processedAt?: number;
  metadata: InteractionMetadata;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  error?: string;
  data?: any;
  executionTime: number;
}

export interface InteractionMetadata {
  inputMode: "voice" | "text";
  responseTime: number;
  userAgent?: string;
}

export interface ToolMetrics {
  toolName: string;
  totalCalls: number;
  successCalls: number;
  failureCalls: number;
  averageResponseTime: number;
  reliability: number;
  lastFailure?: {
    timestamp: number;
    error: string;
    context: string;
  };
  commonErrors: {
    error: string;
    count: number;
    lastOccurrence: number;
  }[];
  contextualSuccess?: Record<string, number>;
  lastUpdated: number;
}

export interface StrategyConflict {
  id: string;
  strategyA: string;
  strategyB: string;
  conflictType: ConflictType;
  severity: ConflictSeverity;
  resolution: ResolutionAction;
  resolvedBy?: "system" | "manual";
  resolvedAt?: number;
  explanation: string;
  createdAt: number;
}

export interface KnowledgeGap {
  id: string;
  capability: string;
  frequency: number;
  examples: string[];
  suggestedTool: string;
  priority: "high" | "medium" | "low";
  detectedAt: number;
  status: "pending_review" | "in_progress" | "resolved" | "wont_fix";
  resolvedWith?: string;
  resolvedAt?: number;
}

export interface OutcomeSignal {
  strategyId: string;
  interactionId: string;
  signalType: OutcomeType;
  weight: number;
  timestamp: number;
}

export interface ValidationResult {
  approved: boolean;
  failedRule?: string;
  reason?: string;
  suggestion?: string;
  note?: string;
  confidence?: number;
  safetyRating?: SafetyRating;
  strategyType?: StrategyType;
  regulatoryBasis?: string;
  conflicts?: string[];
  reasoning?: string;
}

export interface ConflictResult {
  existingStrategyId: string;
  conflictType: ConflictType;
  severity: ConflictSeverity;
  explanation: string;
}

export interface StrategyBudget {
  maxCandidates: number;
  safetyCriticalSlots: number;
  regularSlots: number;
  totalSlots: number;
}

export interface QueryContext {
  maxTokens: number;
  estimatedResponseTokens: number;
  isFollowUp: boolean;
}

export interface ConfidenceConfig {
  momentum: number;
  learningRate: number;
  safetyMultiplier: number;
}
