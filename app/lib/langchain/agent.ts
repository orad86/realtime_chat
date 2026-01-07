import { OpenAI } from "openai";
import { tools } from "./tools";

// Simple tool executor that parses user input and executes the appropriate tool
export async function executeTools(query: string) {
  try {
    // Parse the query to identify which tool to use
    const toolMatch = identifyTool(query);
    
    if (!toolMatch) {
      return `I couldn't identify a specific tool to use for your request. You can ask about weather, calendar, search, or calculations.`;
    }
    
    const { tool, input } = toolMatch;
    const result = await tool._call(input);
    
    return result;
  } catch (error) {
    console.error("Error executing tool:", error);
    return `I encountered an error while processing your request: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// Helper function to identify which tool to use based on the query
function identifyTool(query: string) {
  const lowerQuery = query.toLowerCase();
  
  // Check for weather queries
  if (lowerQuery.includes("weather")) {
    const locationMatch = query.match(/weather\s+(?:in|for|at)?\s+([\w\s,]+)/i);
    const location = locationMatch ? locationMatch[1].trim() : "the current location";
    return { tool: tools[0], input: location };
  }
  
  // Check for calendar queries
  if (lowerQuery.includes("calendar") || lowerQuery.includes("schedule") || lowerQuery.includes("meeting")) {
    return { tool: tools[1], input: query };
  }
  
  // Check for search queries
  if (lowerQuery.includes("search") || lowerQuery.includes("find") || lowerQuery.includes("look up")) {
    const searchQuery = query.replace(/search(\s+for)?|find|look\s+up/gi, "").trim();
    return { tool: tools[2], input: searchQuery };
  }
  
  // Check for calculation queries
  if (lowerQuery.includes("calculate") || 
      lowerQuery.includes("how much is") ||
      lowerQuery.includes("what is") ||
      lowerQuery.match(/[0-9]\s*[+\-*\/]\s*[0-9]/) ||
      /[0-9+\-*\/()]+/.test(lowerQuery)) {
    
    // Extract the mathematical expression
    let mathExpression = query;
    
    // Remove common phrases
    mathExpression = mathExpression.replace(/calculate|compute|what\s+is|how\s+much\s+is|tell\s+me\s+how\s+much\s+is|tell\s+me\s+what\s+is/gi, "").trim();
    
    // Handle expressions like "1 plus 1" or "2 times 3"
    mathExpression = mathExpression
      .replace(/\s+plus\s+/gi, "+")
      .replace(/\s+minus\s+/gi, "-")
      .replace(/\s+times\s+/gi, "*")
      .replace(/\s+multiplied\s+by\s+/gi, "*")
      .replace(/\s+divided\s+by\s+/gi, "/")
      .replace(/\s+over\s+/gi, "/");
    
    console.log("Identified calculation query:", query);
    console.log("Extracted math expression:", mathExpression);
    
    return { tool: tools[3], input: mathExpression };
  }
  
  return null;
}

// Function to handle user queries and execute tools
export async function handleQuery(query: string) {
  try {
    // First try to execute a specific tool
    const toolResult = await executeTools(query);
    
    // If we couldn't identify a tool, use OpenAI directly
    if (toolResult.includes("couldn't identify")) {
      // In a real implementation, we would use OpenAI to handle general queries
      return `I'm not sure how to help with that specific request. You can ask me about weather, calendar events, search for information, or perform calculations.`;
    }
    
    return toolResult;
  } catch (error) {
    console.error("Error handling query:", error);
    return `I encountered an error while processing your request: ${error instanceof Error ? error.message : String(error)}`;
  }
}
