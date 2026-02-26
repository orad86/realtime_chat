import { StrategyType, OutcomeType, ConfidenceConfig } from "./types";

// DynamoDB table names
export const TABLE_NAMES = {
  INTERACTIONS: process.env.DYNAMODB_INTERACTIONS_TABLE || "AgentInteractions",
  STRATEGIES: process.env.DYNAMODB_STRATEGIES_TABLE || "AgentStrategies",
  TOOL_METRICS: process.env.DYNAMODB_TOOL_METRICS_TABLE || "ToolMetrics",
  CONFLICTS: process.env.DYNAMODB_CONFLICTS_TABLE || "StrategyConflicts",
  KNOWLEDGE_GAPS: process.env.DYNAMODB_KNOWLEDGE_GAPS_TABLE || "KnowledgeGaps",
  USER_PREFERENCES: process.env.DYNAMODB_USER_PREFERENCES_TABLE || "UserPreferences"
};

// Outcome weights for confidence updates
export const OUTCOME_WEIGHTS: Record<OutcomeType, number> = {
  [OutcomeType.USER_ACCEPTED]: 0.05,
  [OutcomeType.TOOL_SUCCESS]: 0.03,
  [OutcomeType.NO_CORRECTION]: 0.02,
  [OutcomeType.FOLLOW_UP_QUESTION]: 0.01,
  [OutcomeType.USER_CORRECTED]: -0.10,
  [OutcomeType.TOOL_FAILURE]: -0.05,
  [OutcomeType.CONTRADICTION]: -0.15,
  [OutcomeType.SAFETY_VIOLATION]: -1.0,
  [OutcomeType.NOT_APPLIED]: 0
};

// Confidence configuration per strategy type
export const CONFIDENCE_CONFIG: Record<StrategyType, ConfidenceConfig> = {
  [StrategyType.SAFETY_CRITICAL]: {
    momentum: 0.9,
    learningRate: 0.05,
    safetyMultiplier: 3.0
  },
  [StrategyType.REGULATORY]: {
    momentum: 0.85,
    learningRate: 0.08,
    safetyMultiplier: 2.0
  },
  [StrategyType.TOOL_OPTIMIZATION]: {
    momentum: 0.7,
    learningRate: 0.15,
    safetyMultiplier: 1.0
  },
  [StrategyType.REASONING_HEURISTIC]: {
    momentum: 0.75,
    learningRate: 0.12,
    safetyMultiplier: 1.5
  },
  [StrategyType.COMMUNICATION]: {
    momentum: 0.6,
    learningRate: 0.2,
    safetyMultiplier: 1.0
  },
  [StrategyType.EXPERIMENTAL]: {
    momentum: 0.5,
    learningRate: 0.25,
    safetyMultiplier: 1.0
  }
};

// Strategy rules per type
export const STRATEGY_RULES = {
  [StrategyType.SAFETY_CRITICAL]: {
    minConfidence: 0.9,
    decayRate: 0,
    injectionPriority: 10,
    requiresManualReview: true,
    maxCount: 50,
    maxAge: null
  },
  [StrategyType.REGULATORY]: {
    minConfidence: 0.8,
    decayRate: 0,
    injectionPriority: 9,
    requiresCitation: true,
    maxCount: 100,
    maxAge: null
  },
  [StrategyType.TOOL_OPTIMIZATION]: {
    minConfidence: 0.5,
    decayRate: 0.01,
    injectionPriority: 6,
    maxCount: 150,
    maxAge: 90 * 24 * 60 * 60 * 1000
  },
  [StrategyType.REASONING_HEURISTIC]: {
    minConfidence: 0.4,
    decayRate: 0.02,
    injectionPriority: 5,
    maxCount: 200,
    maxAge: 60 * 24 * 60 * 60 * 1000
  },
  [StrategyType.COMMUNICATION]: {
    minConfidence: 0.3,
    decayRate: 0.03,
    injectionPriority: 3,
    maxCount: 100,
    maxAge: 30 * 24 * 60 * 60 * 1000
  },
  [StrategyType.EXPERIMENTAL]: {
    minConfidence: 0.2,
    decayRate: 0.05,
    injectionPriority: 1,
    maxCount: 50,
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
};

// Category keywords for detection
export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  weather: ["weather", "metar", "taf", "wind", "visibility", "ceiling", "vfr", "ifr", "forecast"],
  safety: ["safe", "minimum", "legal", "regulation", "requirement", "unsafe", "hazard"],
  routing: ["route", "flight plan", "waypoint", "airway", "navigation", "direct"],
  procedures: ["approach", "departure", "sid", "star", "procedure", "ils", "rnav"],
  airport: ["airport", "runway", "taxiway", "notam", "ramp", "gate"],
  tools: ["tool", "api", "data", "query", "search"]
};

// Validation rules configuration
export const VALIDATION_CONFIG = {
  maxStrategyLength: 500,
  minConfidenceThreshold: 0.4,
  regulatoryPatterns: [
    /14 CFR \d+\.\d+/i,
    /FAR \d+\.\d+/i,
    /AIM \d+-\d+-\d+/i
  ],
  domainAnchors: [
    /per (14 CFR|FAR|regulation|AIM)/i,
    /below (MDA|DA|DH|MEA|MOCA)/i,
    /without (visual|clearance|authorization|contact)/i,
    /\d+\s*(SM|feet|knots|degrees|nautical miles)/i,
    /(approach|departure|emergency) (procedure|minima)/i
  ],
  overlySpecificPatterns: [
    /runway \d+[LRC]? at [A-Z]{4}/i,
    /\d{2}:\d{2} (UTC|local|zulu)/i,
    /on (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i,
    /pilot named/i,
    /aircraft N\d+/i
  ]
};

// Softmax temperature for tool selection
export const TOOL_SELECTION_TEMPERATURE = 0.3;

// Minimum tool reliability threshold
export const MIN_TOOL_RELIABILITY = 0.2;

// Strategy consolidation settings
export const CONSOLIDATION_CONFIG = {
  similarityThreshold: 0.7,
  mergeConfidencePenalty: 0.9,
  runFrequency: 7 * 24 * 60 * 60 * 1000 // Weekly
};

// TTL settings (in seconds)
export const TTL_CONFIG = {
  interactions: 90 * 24 * 60 * 60, // 90 days
  resolvedConflicts: 30 * 24 * 60 * 60, // 30 days
  resolvedGaps: 90 * 24 * 60 * 60 // 90 days
};
