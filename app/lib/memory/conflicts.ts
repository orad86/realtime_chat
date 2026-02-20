import OpenAI from "openai";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { dynamo } from "../aws/dynamodb";
import { v4 as uuid } from "uuid";
import { ConflictResult, ConflictType, ConflictSeverity, ResolutionAction, Strategy } from "./types";
import { TABLE_NAMES, TTL_CONFIG } from "./constants";
import { getStrategiesByCategory, archiveStrategy, flagStrategyForReview } from "./strategies";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Cheap deterministic conflict detection (pre-filter)
function cheapConflictDetection(strategyA: string, strategyB: string): {
  likelyConflict: boolean;
  reason?: string;
  confidence: number;
} {
  const a = strategyA.toLowerCase();
  const b = strategyB.toLowerCase();
  
  // 1. Opposite polarity detection
  const polarityPairs = [
    ["always", "never"],
    ["must", "must not"],
    ["should", "should not"],
    ["require", "prohibit"],
    ["above", "below"],
    ["before", "after"]
  ];
  
  for (const [pos, neg] of polarityPairs) {
    if ((a.includes(pos) && b.includes(neg)) || (a.includes(neg) && b.includes(pos))) {
      const sharedKeywords = findSharedKeywords(a, b);
      if (sharedKeywords.length > 2) {
        return { 
          likelyConflict: true, 
          reason: "opposite_polarity",
          confidence: 0.8 
        };
      }
    }
  }
  
  // 2. Numeric contradiction detection with context
  const numbersA = extractNumbers(a);
  const numbersB = extractNumbers(b);
  
  if (numbersA.length > 0 && numbersB.length > 0) {
    const sharedContext = findSharedKeywords(a, b);
    if (sharedContext.length > 2) {
      // Check if same operational variable
      const variableKeywords = ["knots", "feet", "mda", "da", "visibility", "ceiling"];
      const hasSharedVariable = variableKeywords.some(v => a.includes(v) && b.includes(v));
      
      if (hasSharedVariable) {
        const hasDifferentNumbers = numbersA.some(na => 
          !numbersB.some(nb => Math.abs(na - nb) < 0.1)
        );
        
        if (hasDifferentNumbers) {
          return { 
            likelyConflict: true, 
            reason: "numeric_contradiction",
            confidence: 0.7 
          };
        }
      }
    }
  }
  
  // 3. Keyword inversion detection
  const inversionKeywords = [
    ["use", "avoid"],
    ["prefer", "avoid"],
    ["recommend", "discourage"],
    ["safe", "unsafe"],
    ["legal", "illegal"]
  ];
  
  for (const [pos, neg] of inversionKeywords) {
    if ((a.includes(pos) && b.includes(neg)) || (a.includes(neg) && b.includes(pos))) {
      const sharedKeywords = findSharedKeywords(a, b);
      if (sharedKeywords.length > 2) {
        return { 
          likelyConflict: true, 
          reason: "keyword_inversion",
          confidence: 0.75 
        };
      }
    }
  }
  
  // 4. High similarity but different conclusions
  const similarity = calculateSimilarity(a, b);
  if (similarity > 0.7) {
    const conclusionA = extractConclusion(a);
    const conclusionB = extractConclusion(b);
    
    if (conclusionA !== conclusionB) {
      return { 
        likelyConflict: true, 
        reason: "similar_context_different_conclusion",
        confidence: 0.6 
      };
    }
  }
  
  return { likelyConflict: false, confidence: 0 };
}

// Helper functions
function findSharedKeywords(a: string, b: string): string[] {
  const stopWords = new Set(["the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for"]);
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w)));
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w)));
  return Array.from(wordsA).filter(w => wordsB.has(w));
}

function extractNumbers(text: string): number[] {
  const matches = text.match(/\d+\.?\d*/g);
  return matches ? matches.map(Number) : [];
}

function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}

function extractConclusion(text: string): string {
  // Simple heuristic: last sentence or clause
  const sentences = text.split(/[.!?]/);
  return sentences[sentences.length - 1]?.trim() || text;
}

// GPT-based conflict analysis (expensive, only for likely conflicts)
async function gptConflictAnalysis(
  strategyA: string,
  strategyB: string
): Promise<ConflictResult | null> {
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Cheaper model for conflict detection
      messages: [{
        role: "system",
        content: `
Detect if these two aviation strategies conflict:

STRATEGY A: "${strategyA}"
STRATEGY B: "${strategyB}"

Return JSON:
{
  "conflicts": boolean,
  "conflictType": "direct_opposite" | "overlapping" | "contradictory_conditions" | "none",
  "severity": "critical" | "moderate" | "minor" | "none",
  "explanation": string
}

Examples:
- "Always use X" vs "Never use X" = direct_opposite, critical
- "Use X when Y" vs "Use Z when Y" = overlapping, moderate
- "VFR requires 3SM" vs "VFR requires 5SM" = contradictory_conditions, critical
`
      }],
      response_format: { type: "json_object" },
      temperature: 0.3
    });

    const result = JSON.parse(response.choices[0].message.content || "{}");
    
    if (result.conflicts && result.severity !== "none") {
      return {
        existingStrategyId: "", // Will be filled by caller
        conflictType: result.conflictType as ConflictType,
        severity: result.severity as ConflictSeverity,
        explanation: result.explanation
      };
    }
    
    return null;
  } catch (error) {
    console.error("[Memory] GPT conflict analysis failed:", error);
    return null;
  }
}

// Detect conflicts for a new strategy
export async function detectConflicts(
  newStrategy: string,
  category: string
): Promise<ConflictResult[]> {
  
  const existing = await getStrategiesByCategory(category);
  const conflicts: ConflictResult[] = [];
  
  console.log(`[Memory] Checking ${existing.length} existing strategies for conflicts`);
  
  for (const existingStrategy of existing) {
    // Stage 1: Cheap pre-filter
    const quickCheck = cheapConflictDetection(newStrategy, existingStrategy.strategy);
    
    if (quickCheck.likelyConflict) {
      console.log(`[Memory] Potential conflict detected with ${existingStrategy.id}: ${quickCheck.reason}`);
      
      // Stage 2: Expensive GPT validation
      const detailedAnalysis = await gptConflictAnalysis(newStrategy, existingStrategy.strategy);
      
      if (detailedAnalysis) {
        conflicts.push({
          ...detailedAnalysis,
          existingStrategyId: existingStrategy.id
        });
      }
    }
  }
  
  return conflicts;
}

// Resolve conflict between strategies
export async function resolveConflict(
  newStrategy: Strategy,
  existingStrategy: Strategy,
  conflict: ConflictResult
): Promise<ResolutionAction> {
  
  // Rule 1: Safety-critical always wins
  if (existingStrategy.isCritical) {
    return ResolutionAction.REJECT_NEW;
  }
  
  if (newStrategy.isCritical) {
    return ResolutionAction.REPLACE_EXISTING;
  }
  
  // Rule 2: Higher confidence wins (if significant difference)
  if (Math.abs(newStrategy.confidence - existingStrategy.confidence) > 0.2) {
    return newStrategy.confidence > existingStrategy.confidence 
      ? ResolutionAction.REPLACE_EXISTING 
      : ResolutionAction.REJECT_NEW;
  }
  
  // Rule 3: Flag for manual review
  return ResolutionAction.FLAG_FOR_REVIEW;
}

// Save conflict record
export async function saveConflict(
  strategyA: string,
  strategyB: string,
  conflictType: ConflictType,
  severity: ConflictSeverity,
  resolution: ResolutionAction,
  explanation: string
): Promise<void> {
  
  const id = uuid();
  const timestamp = Date.now();
  
  try {
    await dynamo.send(new PutCommand({
      TableName: TABLE_NAMES.CONFLICTS,
      Item: {
        PK: `CONFLICT#${id}`,
        SK: `DETECTED#${timestamp}`,
        GSI1PK: `STATUS#${resolution}`,
        GSI1SK: `SEVERITY#${severity}#TIME#${timestamp}`,
        id,
        strategyA,
        strategyB,
        conflictType,
        severity,
        resolution,
        explanation,
        createdAt: timestamp,
        ttl: resolution === ResolutionAction.RESOLVED 
          ? Math.floor(Date.now() / 1000) + TTL_CONFIG.resolvedConflicts 
          : undefined
      }
    }));
    
    console.log(`[Memory] Saved conflict ${id}: ${resolution}`);
  } catch (error) {
    console.error("[Memory] Failed to save conflict:", error);
  }
}

// Get unresolved conflicts
export async function getUnresolvedConflicts(limit: number = 50): Promise<any[]> {
  
  try {
    const result = await dynamo.send(new QueryCommand({
      TableName: TABLE_NAMES.CONFLICTS,
      IndexName: "ResolutionIndex",
      KeyConditionExpression: "GSI1PK = :status",
      ExpressionAttributeValues: {
        ":status": `STATUS#${ResolutionAction.FLAG_FOR_REVIEW}`
      },
      Limit: limit,
      ScanIndexForward: false // Most recent first
    }));
    
    return result.Items || [];
  } catch (error) {
    console.error("[Memory] Failed to get unresolved conflicts:", error);
    return [];
  }
}
