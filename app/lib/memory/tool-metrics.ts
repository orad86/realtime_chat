import { UpdateCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { dynamo } from "../aws/dynamodb";
import { ToolMetrics } from "./types";
import { TABLE_NAMES } from "./constants";

// Record a tool execution
export async function recordToolExecution(
  toolName: string,
  success: boolean,
  responseTime: number,
  error?: string,
  context?: string
): Promise<void> {
  
  try {
    // Get current metrics
    const current = await getToolMetrics(toolName);
    
    // Calculate new metrics
    const totalCalls = current.totalCalls + 1;
    const successCalls = current.successCalls + (success ? 1 : 0);
    const failureCalls = current.failureCalls + (success ? 0 : 1);
    const reliability = successCalls / totalCalls;
    
    // Calculate running average for response time
    const avgResponseTime = 
      (current.averageResponseTime * current.totalCalls + responseTime) / totalCalls;
    
    // Update common errors if failure
    const commonErrors = [...current.commonErrors];
    if (!success && error) {
      const existingError = commonErrors.find(e => e.error === error);
      if (existingError) {
        existingError.count++;
        existingError.lastOccurrence = Date.now();
      } else {
        commonErrors.push({
          error,
          count: 1,
          lastOccurrence: Date.now()
        });
      }
      
      // Keep only top 5 errors
      commonErrors.sort((a, b) => b.count - a.count);
      if (commonErrors.length > 5) {
        commonErrors.length = 5;
      }
    }
    
    // Prepare update
    const updates: any = {
      totalCalls,
      successCalls,
      failureCalls,
      averageResponseTime: avgResponseTime,
      reliability,
      commonErrors,
      lastUpdated: Date.now(),
      GSI1PK: "RELIABILITY",
      GSI1SK: `SCORE#${reliability.toFixed(4)}#TOOL#${toolName}`
    };
    
    if (!success && error) {
      updates.lastFailure = {
        timestamp: Date.now(),
        error,
        context: context || "unknown"
      };
    }
    
    await dynamo.send(new PutCommand({
      TableName: TABLE_NAMES.TOOL_METRICS,
      Item: {
        PK: `TOOL#${toolName}`,
        SK: "METRIC#current",
        toolName,
        ...updates
      }
    }));
    
    console.log(`[Memory] Updated metrics for tool ${toolName}: reliability=${reliability.toFixed(2)}`);
    
    // Flag tool for review if reliability drops too low
    if (reliability < 0.5 && totalCalls > 10) {
      console.warn(`[Memory] Tool ${toolName} has low reliability: ${reliability.toFixed(2)}`);
    }
  } catch (error) {
    console.error(`[Memory] Failed to record tool execution for ${toolName}:`, error);
  }
}

// Get tool metrics
export async function getToolMetrics(toolName: string): Promise<ToolMetrics> {
  
  try {
    const result = await dynamo.send(new GetCommand({
      TableName: TABLE_NAMES.TOOL_METRICS,
      Key: {
        PK: `TOOL#${toolName}`,
        SK: "METRIC#current"
      }
    }));
    
    if (result.Item) {
      return result.Item as ToolMetrics;
    }
    
    // Return default metrics if not found
    return {
      toolName,
      totalCalls: 0,
      successCalls: 0,
      failureCalls: 0,
      averageResponseTime: 0,
      reliability: 1.0, // Start optimistic
      commonErrors: [],
      lastUpdated: Date.now()
    };
  } catch (error) {
    console.error(`[Memory] Failed to get metrics for ${toolName}:`, error);
    
    // Return default on error
    return {
      toolName,
      totalCalls: 0,
      successCalls: 0,
      failureCalls: 0,
      averageResponseTime: 0,
      reliability: 1.0,
      commonErrors: [],
      lastUpdated: Date.now()
    };
  }
}

// Get all tools sorted by reliability
export async function getToolsByReliability(limit: number = 50): Promise<ToolMetrics[]> {
  
  const { QueryCommand } = await import("@aws-sdk/lib-dynamodb");
  
  try {
    const result = await dynamo.send(new QueryCommand({
      TableName: TABLE_NAMES.TOOL_METRICS,
      IndexName: "ReliabilityIndex",
      KeyConditionExpression: "GSI1PK = :reliability",
      ExpressionAttributeValues: {
        ":reliability": "RELIABILITY"
      },
      Limit: limit,
      ScanIndexForward: false // Highest reliability first
    }));
    
    return (result.Items || []) as ToolMetrics[];
  } catch (error) {
    console.error("[Memory] Failed to get tools by reliability:", error);
    return [];
  }
}

// Update contextual success for a tool
export async function updateContextualSuccess(
  toolName: string,
  intent: string,
  success: boolean
): Promise<void> {
  
  try {
    const metrics = await getToolMetrics(toolName);
    const contextualSuccess = metrics.contextualSuccess || {};
    
    // Update success rate for this intent
    const currentRate = contextualSuccess[intent] || 0.5;
    const newRate = currentRate * 0.9 + (success ? 0.1 : 0); // Exponential moving average
    
    contextualSuccess[intent] = newRate;
    
    await dynamo.send(new UpdateCommand({
      TableName: TABLE_NAMES.TOOL_METRICS,
      Key: {
        PK: `TOOL#${toolName}`,
        SK: "METRIC#current"
      },
      UpdateExpression: "SET contextualSuccess = :cs",
      ExpressionAttributeValues: {
        ":cs": contextualSuccess
      }
    }));
  } catch (error) {
    console.error(`[Memory] Failed to update contextual success for ${toolName}:`, error);
  }
}
