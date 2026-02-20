import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { dynamo } from "../aws/dynamodb";
import { v4 as uuid } from "uuid";
import { Interaction, ToolResult, InteractionMetadata } from "./types";
import { TABLE_NAMES, TTL_CONFIG } from "./constants";

export async function logInteraction({
  sessionId,
  userMessage,
  agentResponse,
  responseChunks,
  toolsUsed,
  toolResults,
  appliedStrategies = [],
  metadata
}: {
  sessionId: string;
  userMessage: string;
  agentResponse: string;
  responseChunks?: string[];
  toolsUsed: string[];
  toolResults: ToolResult[];
  appliedStrategies?: string[];
  metadata: InteractionMetadata;
}): Promise<string> {
  
  const id = uuid();
  const timestamp = Date.now();
  
  const interaction: Interaction & {
    PK: string;
    SK: string;
    GSI1PK: string;
    GSI1SK: string;
    ttl: number;
  } = {
    // DynamoDB keys
    PK: `SESSION#${sessionId}`,
    SK: `INTERACTION#${timestamp}#${id}`,
    GSI1PK: "PROCESSED#false",
    GSI1SK: `TIMESTAMP#${timestamp}`,
    
    // Core data
    id,
    sessionId,
    userMessage,
    agentResponse,
    responseChunks,
    toolsUsed,
    toolResults,
    appliedStrategies,
    timestamp,
    processed: false,
    metadata,
    
    // TTL for auto-cleanup after 90 days
    ttl: Math.floor(Date.now() / 1000) + TTL_CONFIG.interactions
  };

  try {
    await dynamo.send(new PutCommand({
      TableName: TABLE_NAMES.INTERACTIONS,
      Item: interaction
    }));
    
    console.log(`[Memory] Logged interaction ${id} for session ${sessionId}`);
    return id;
  } catch (error) {
    console.error("[Memory] Failed to log interaction:", error);
    throw error;
  }
}

// Mark interaction as processed
export async function markInteractionProcessed(
  interactionId: string,
  sessionId: string,
  timestamp: number
): Promise<void> {
  
  const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
  
  try {
    await dynamo.send(new UpdateCommand({
      TableName: TABLE_NAMES.INTERACTIONS,
      Key: {
        PK: `SESSION#${sessionId}`,
        SK: `INTERACTION#${timestamp}#${interactionId}`
      },
      UpdateExpression: "SET #processed = :true, processedAt = :now, GSI1PK = :processed",
      ExpressionAttributeNames: {
        "#processed": "processed"
      },
      ExpressionAttributeValues: {
        ":true": true,
        ":now": Date.now(),
        ":processed": "PROCESSED#true"
      }
    }));
    
    console.log(`[Memory] Marked interaction ${interactionId} as processed`);
  } catch (error) {
    console.error("[Memory] Failed to mark interaction as processed:", error);
    throw error;
  }
}

// Get unprocessed interactions for batch learning
export async function getUnprocessedInteractions(limit: number = 50): Promise<Interaction[]> {
  
  const { QueryCommand } = await import("@aws-sdk/lib-dynamodb");
  
  try {
    const result = await dynamo.send(new QueryCommand({
      TableName: TABLE_NAMES.INTERACTIONS,
      IndexName: "ProcessingIndex",
      KeyConditionExpression: "GSI1PK = :processed",
      ExpressionAttributeValues: {
        ":processed": "PROCESSED#false"
      },
      Limit: limit,
      ScanIndexForward: true // Oldest first
    }));
    
    return (result.Items || []) as Interaction[];
  } catch (error) {
    console.error("[Memory] Failed to get unprocessed interactions:", error);
    return [];
  }
}

// Get interaction history for a session
export async function getSessionHistory(
  sessionId: string,
  limit: number = 50
): Promise<Interaction[]> {
  
  const { QueryCommand } = await import("@aws-sdk/lib-dynamodb");
  
  try {
    const result = await dynamo.send(new QueryCommand({
      TableName: TABLE_NAMES.INTERACTIONS,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": `SESSION#${sessionId}`
      },
      Limit: limit,
      ScanIndexForward: false // Newest first
    }));
    
    return (result.Items || []) as Interaction[];
  } catch (error) {
    console.error("[Memory] Failed to get session history:", error);
    return [];
  }
}
