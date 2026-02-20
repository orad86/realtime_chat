import { PutCommand, GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamo } from "../aws/dynamodb";
import { v4 as uuid } from "uuid";
import { Strategy, StrategyType, SafetyRating, StrategyStatus } from "./types";
import { TABLE_NAMES, STRATEGY_RULES } from "./constants";

// Save a new strategy
export async function saveStrategy(
  strategy: Omit<Strategy, "id" | "version" | "createdAt" | "status">
): Promise<string> {
  
  const id = uuid();
  const version = 1;
  const timestamp = Date.now();
  
  const typeRules = STRATEGY_RULES[strategy.type];
  const expiresAt = typeRules.maxAge ? timestamp + typeRules.maxAge : undefined;
  
  const newStrategy: Strategy & {
    PK: string;
    SK: string;
    GSI1PK: string;
    GSI1SK: string;
    GSI2PK: string;
    GSI2SK: string;
    GSI3PK: string;
    GSI3SK: string;
    ttl?: number;
  } = {
    // DynamoDB keys
    PK: `STRATEGY#${id}`,
    SK: `v#${version}`,
    GSI1PK: `CATEGORY#${strategy.category}`,
    GSI1SK: `PRIORITY#${String(strategy.priority).padStart(2, '0')}#CONF#${strategy.confidence.toFixed(4)}`,
    GSI2PK: `TYPE#${strategy.type}`,
    GSI2SK: `CONF#${strategy.confidence.toFixed(4)}#USED#${timestamp}`,
    GSI3PK: "ACTIVE#true",
    GSI3SK: `SUCCESS#${strategy.successRate.toFixed(4)}#APPLIED#${String(strategy.appliedCount).padStart(10, '0')}`,
    
    // Core data
    id,
    version,
    ...strategy,
    createdAt: timestamp,
    status: StrategyStatus.ACTIVE,
    
    // TTL for non-critical strategies
    ...(expiresAt && !strategy.isCritical ? { 
      expiresAt,
      ttl: Math.floor(expiresAt / 1000) 
    } : {})
  };

  try {
    await dynamo.send(new PutCommand({
      TableName: TABLE_NAMES.STRATEGIES,
      Item: newStrategy
    }));
    
    console.log(`[Memory] Saved strategy ${id} (${strategy.type}): ${strategy.strategy.substring(0, 50)}...`);
    return id;
  } catch (error) {
    console.error("[Memory] Failed to save strategy:", error);
    throw error;
  }
}

// Get strategy by ID
export async function getStrategy(id: string): Promise<Strategy | null> {
  
  try {
    const result = await dynamo.send(new QueryCommand({
      TableName: TABLE_NAMES.STRATEGIES,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": `STRATEGY#${id}`
      },
      ScanIndexForward: false, // Latest version first
      Limit: 1
    }));
    
    if (result.Items && result.Items.length > 0) {
      return result.Items[0] as Strategy;
    }
    
    return null;
  } catch (error) {
    console.error(`[Memory] Failed to get strategy ${id}:`, error);
    return null;
  }
}

// Get strategies by category
export async function getStrategiesByCategory(
  category: string,
  minConfidence: number = 0.3,
  limit: number = 50
): Promise<Strategy[]> {
  
  try {
    const result = await dynamo.send(new QueryCommand({
      TableName: TABLE_NAMES.STRATEGIES,
      IndexName: "CategoryPriorityIndex",
      KeyConditionExpression: "GSI1PK = :category",
      FilterExpression: "confidence >= :minConf AND #status = :active",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":category": `CATEGORY#${category}`,
        ":minConf": minConfidence,
        ":active": StrategyStatus.ACTIVE
      },
      Limit: limit,
      ScanIndexForward: false // Highest priority first
    }));
    
    return (result.Items || []) as Strategy[];
  } catch (error) {
    console.error(`[Memory] Failed to get strategies for category ${category}:`, error);
    return [];
  }
}

// Get strategies by type
export async function getStrategiesByType(
  type: StrategyType,
  minConfidence: number = 0.3,
  limit: number = 50
): Promise<Strategy[]> {
  
  try {
    const result = await dynamo.send(new QueryCommand({
      TableName: TABLE_NAMES.STRATEGIES,
      IndexName: "TypeConfidenceIndex",
      KeyConditionExpression: "GSI2PK = :type",
      FilterExpression: "confidence >= :minConf AND #status = :active",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":type": `TYPE#${type}`,
        ":minConf": minConfidence,
        ":active": StrategyStatus.ACTIVE
      },
      Limit: limit,
      ScanIndexForward: false // Highest confidence first
    }));
    
    return (result.Items || []) as Strategy[];
  } catch (error) {
    console.error(`[Memory] Failed to get strategies for type ${type}:`, error);
    return [];
  }
}

// Get safety-critical strategies
export async function getSafetyCriticalStrategies(
  categories?: string[]
): Promise<Strategy[]> {
  
  const strategies = await getStrategiesByType(StrategyType.SAFETY_CRITICAL, 0.8);
  
  if (categories && categories.length > 0) {
    return strategies.filter(s => categories.includes(s.category));
  }
  
  return strategies;
}

// Get best performing strategies
export async function getBestStrategies(limit: number = 20): Promise<Strategy[]> {
  
  try {
    const result = await dynamo.send(new QueryCommand({
      TableName: TABLE_NAMES.STRATEGIES,
      IndexName: "QualityIndex",
      KeyConditionExpression: "GSI3PK = :active",
      FilterExpression: "successRate >= :minSuccess",
      ExpressionAttributeValues: {
        ":active": "ACTIVE#true",
        ":minSuccess": 0.7
      },
      Limit: limit,
      ScanIndexForward: false // Best performers first
    }));
    
    return (result.Items || []) as Strategy[];
  } catch (error) {
    console.error("[Memory] Failed to get best strategies:", error);
    return [];
  }
}

// Update strategy confidence
export async function updateStrategyConfidence(
  id: string,
  newConfidence: number,
  successRate: number,
  positiveOutcomes: number,
  negativeOutcomes: number,
  appliedCount: number
): Promise<void> {
  
  try {
    const strategy = await getStrategy(id);
    if (!strategy) {
      throw new Error(`Strategy ${id} not found`);
    }
    
    const timestamp = Date.now();
    
    await dynamo.send(new UpdateCommand({
      TableName: TABLE_NAMES.STRATEGIES,
      Key: {
        PK: `STRATEGY#${id}`,
        SK: `v#${strategy.version}`
      },
      UpdateExpression: `
        SET confidence = :conf,
            successRate = :rate,
            positiveOutcomes = :pos,
            negativeOutcomes = :neg,
            appliedCount = :applied,
            lastUsed = :now,
            GSI1SK = :gsi1sk,
            GSI2SK = :gsi2sk,
            GSI3SK = :gsi3sk
      `,
      ExpressionAttributeValues: {
        ":conf": newConfidence,
        ":rate": successRate,
        ":pos": positiveOutcomes,
        ":neg": negativeOutcomes,
        ":applied": appliedCount,
        ":now": timestamp,
        ":gsi1sk": `PRIORITY#${String(strategy.priority).padStart(2, '0')}#CONF#${newConfidence.toFixed(4)}`,
        ":gsi2sk": `CONF#${newConfidence.toFixed(4)}#USED#${timestamp}`,
        ":gsi3sk": `SUCCESS#${successRate.toFixed(4)}#APPLIED#${String(appliedCount).padStart(10, '0')}`
      }
    }));
    
    console.log(`[Memory] Updated strategy ${id} confidence: ${newConfidence.toFixed(2)}`);
  } catch (error) {
    console.error(`[Memory] Failed to update strategy ${id} confidence:`, error);
    throw error;
  }
}

// Archive strategy
export async function archiveStrategy(id: string, reason: string): Promise<void> {
  
  try {
    const strategy = await getStrategy(id);
    if (!strategy) {
      throw new Error(`Strategy ${id} not found`);
    }
    
    await dynamo.send(new UpdateCommand({
      TableName: TABLE_NAMES.STRATEGIES,
      Key: {
        PK: `STRATEGY#${id}`,
        SK: `v#${strategy.version}`
      },
      UpdateExpression: "SET #status = :archived, GSI3PK = :inactive",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":archived": StrategyStatus.ARCHIVED,
        ":inactive": "ACTIVE#false"
      }
    }));
    
    console.log(`[Memory] Archived strategy ${id}: ${reason}`);
  } catch (error) {
    console.error(`[Memory] Failed to archive strategy ${id}:`, error);
    throw error;
  }
}

// Flag strategy for manual review
export async function flagStrategyForReview(id: string, reason: string): Promise<void> {
  
  try {
    const strategy = await getStrategy(id);
    if (!strategy) {
      throw new Error(`Strategy ${id} not found`);
    }
    
    await dynamo.send(new UpdateCommand({
      TableName: TABLE_NAMES.STRATEGIES,
      Key: {
        PK: `STRATEGY#${id}`,
        SK: `v#${strategy.version}`
      },
      UpdateExpression: "SET #status = :flagged",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":flagged": StrategyStatus.FLAGGED
      }
    }));
    
    console.warn(`[Memory] Flagged strategy ${id} for review: ${reason}`);
  } catch (error) {
    console.error(`[Memory] Failed to flag strategy ${id}:`, error);
    throw error;
  }
}
