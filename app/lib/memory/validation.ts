import OpenAI from "openai";
import { ValidationResult, Strategy, StrategyType, SafetyRating } from "./types";
import { VALIDATION_CONFIG } from "./constants";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

interface ValidationRule {
  name: string;
  check: (strategy: string, context: any) => ValidationResult;
  severity: "block" | "warn" | "info";
}

// Rule-based validation (fast, deterministic)
const VALIDATION_RULES: ValidationRule[] = [
  {
    name: "absolute_with_domain_anchor",
    check: (strategy: string) => {
      const hasAbsolute = /\b(always|never|must|all|every)\b/i.test(strategy);
      
      if (!hasAbsolute) return { approved: true };
      
      const hasAnchor = VALIDATION_CONFIG.domainAnchors.some(pattern => 
        pattern.test(strategy)
      );
      
      if (hasAnchor) {
        return { 
          approved: true, 
          note: "Absolute claim with valid domain anchor" 
        };
      }
      
      return {
        approved: false,
        reason: "Absolute claim without regulatory or operational grounding",
        suggestion: "Add specific context (e.g., 'per 14 CFR', 'below MDA', 'without visual')"
      };
    },
    severity: "block"
  },
  
  {
    name: "regulatory_claim_validation",
    check: (strategy: string) => {
      const hasRegClaim = /\b(14 CFR|FAR|FAA requires|regulation states)\b/i.test(strategy);
      
      if (!hasRegClaim) return { approved: true };
      
      const hasSpecificCitation = VALIDATION_CONFIG.regulatoryPatterns.some(pattern =>
        pattern.test(strategy)
      );
      
      if (!hasSpecificCitation) {
        return {
          approved: false,
          reason: "Regulatory claim without specific citation",
          suggestion: "Include specific regulation number (e.g., '14 CFR 91.155')"
        };
      }
      
      return { approved: true };
    },
    severity: "block"
  },
  
  {
    name: "overfitting_detection",
    check: (strategy: string) => {
      if (VALIDATION_CONFIG.overlySpecificPatterns.some(pattern => pattern.test(strategy))) {
        return {
          approved: false,
          reason: "Strategy too specific to generalize",
          suggestion: "Remove specific identifiers and make pattern-based"
        };
      }
      
      return { approved: true };
    },
    severity: "block"
  },
  
  {
    name: "length_check",
    check: (strategy: string) => {
      if (strategy.length > VALIDATION_CONFIG.maxStrategyLength) {
        return {
          approved: false,
          reason: "Strategy too long, likely overfitted",
          suggestion: "Break into multiple focused strategies"
        };
      }
      return { approved: true };
    },
    severity: "block"
  }
];

// Apply rule-based validation
export function validateWithRules(strategy: string, context?: any): ValidationResult {
  for (const rule of VALIDATION_RULES) {
    const result = rule.check(strategy, context);
    if (!result.approved && rule.severity === "block") {
      const { approved, ...rest } = result;
      return {
        approved: false,
        failedRule: rule.name,
        ...rest
      };
    }
  }
  return { approved: true };
}

// GPT-based semantic validation
export async function validateWithGPT(
  strategy: string,
  context: {
    userQuery?: string;
    agentResponse?: string;
    toolsUsed?: string[];
  }
): Promise<ValidationResult> {
  
  const validationPrompt = `
Evaluate this proposed aviation strategy for safety and validity:

STRATEGY: "${strategy}"

SOURCE CONTEXT:
- User Query: "${context.userQuery || 'N/A'}"
- Agent Response: "${context.agentResponse || 'N/A'}"
- Tools Used: ${context.toolsUsed?.join(", ") || "N/A"}

VALIDATION CHECKLIST:

1. **Universal Validity** (0-1 score)
   - Is this true across all contexts, or overfitted to one case?
   - Example: ❌ "Use runway 27 at KJFK" (too specific)
   - Example: ✅ "Check runway in use before suggesting approach"

2. **Aviation Safety** (CRITICAL/SAFE/UNSAFE)
   - Could this lead to unsafe advice?
   - Does it contradict known regulations?
   - Example: ❌ "VFR is fine with 2SM visibility" (unsafe)
   - Example: ✅ "Verify VFR minimums before suggesting VFR"

3. **Regulatory Accuracy** (VERIFIED/UNVERIFIED/INCORRECT)
   - Does it claim regulatory basis?
   - If yes, is it accurate?
   - Example: ❌ "FAA requires 5SM for Class B" (incorrect)
   - Example: ✅ "Class B VFR requires 3SM visibility per 14 CFR 91.155"

4. **Conflict Detection** (COMPATIBLE/CONFLICTS/UNKNOWN)
   - Could this contradict existing strategies?
   - Does it overlap with known patterns?

5. **Generalization Score** (0-1)
   - How broadly applicable is this?
   - 0.0 = One-time edge case
   - 1.0 = Universal aviation principle

Return JSON:
{
  "approved": boolean,
  "confidence": 0.0-1.0,
  "safetyRating": "CRITICAL" | "SAFE" | "UNSAFE",
  "strategyType": "safety_critical" | "regulatory" | "tool_optimization" | "reasoning_heuristic" | "communication" | "experimental",
  "regulatoryBasis": string | null,
  "conflicts": [],
  "reasoning": string
}

If UNSAFE or confidence < 0.4, reject.
If CRITICAL safety, mark as safety_critical type.
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "system",
        content: validationPrompt
      }],
      response_format: { type: "json_object" },
      temperature: 0.3
    });

    const result = JSON.parse(response.choices[0].message.content || "{}");
    
    const isApproved = result.approved && result.confidence >= VALIDATION_CONFIG.minConfidenceThreshold;
    
    return {
      approved: isApproved,
      confidence: result.confidence,
      safetyRating: result.safetyRating as SafetyRating,
      strategyType: result.strategyType as StrategyType,
      regulatoryBasis: result.regulatoryBasis,
      conflicts: result.conflicts || [],
      reasoning: result.reasoning
    };
  } catch (error) {
    console.error("GPT validation error:", error);
    return {
      approved: false,
      reason: "GPT validation failed",
      suggestion: "Manual review required"
    };
  }
}

// Combined validation (rule-based + GPT)
export async function validateStrategy(
  strategy: string,
  context: {
    userQuery?: string;
    agentResponse?: string;
    toolsUsed?: string[];
  }
): Promise<ValidationResult> {
  
  // Stage 1: Fast rule-based validation
  const ruleResult = validateWithRules(strategy, context);
  if (!ruleResult.approved) {
    return ruleResult;
  }
  
  // Stage 2: GPT semantic validation
  const gptResult = await validateWithGPT(strategy, context);
  
  return gptResult;
}
