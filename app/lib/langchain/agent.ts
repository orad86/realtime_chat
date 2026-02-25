import OpenAI from "openai";
import { tools as aeroTools, handlers, formatToolResult } from "@orad86/ai-aero-tools";
import { createDocumentWrapper } from "../tools/create-document-wrapper";
import { selectStrategiesWithDynamicBudget, formatStrategiesForPrompt, getStrategyIds } from "../memory/injection";
import { logInteraction } from "../memory/log-interaction";
import { recordToolExecution } from "../memory/tool-metrics";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Model configuration
const AGENT_MODEL = "gpt-5";
const REASONING_EFFORT: "low" | "medium" | "high" = "medium";

// Wrapper for calculate_weight_balance to handle missing loads parameter
const weightBalanceWrapper = async (args: any) => {
  // Ensure loads is an object, default to empty if missing/null
  if (!args.loads || typeof args.loads !== 'object') {
    args.loads = {};
  }
  return handlers.calculate_weight_balance(args);
};

// Override handlers to use web-accessible create_document and fix tool name mismatches
const overriddenHandlers = {
  ...handlers,
  create_document: createDocumentWrapper.execute,
  calculate_weight_balance: weightBalanceWrapper,
  // Tool definition uses generate_flight_briefing but handler is flight_briefing
  generate_flight_briefing: handlers.flight_briefing
};

const SYSTEM_PROMPT = `You are an AI aviation assistant with a long-term memory system.

MEMORY CAPABILITIES:
You learn from every interaction and accumulate operational knowledge over time. You have:
- Learned strategies from past successful interactions (shown below when relevant)
- The ability to remember user preferences, personal information, and context across conversations
- Growing expertise in aviation operations based on real-world usage patterns

When users share personal information (name, email, preferences, aircraft type, home airport, etc.),
remember it and use it naturally in future conversations. You can reference past interactions and
acknowledge that you're learning and improving from experience.

AVIATION TOOLS:
You have access to specialized aviation tools from @orad86/ai-aero-tools for:
- Airport information
- Aviation weather (METAR/TAF-style data and forecasts)
- NOTAMs
- General weather forecasts for flight planning
- Route analysis and flight planning (bearings, distances, airways, waypoints)
- Loading professional guidelines and pilot history
- Email sending via AWS SES (verified recipients only)
- Task scheduling with natural language times ("in 5 minutes", "tomorrow at 8am")
- Document upload and management (upload_document tool for images, PDFs, and documents)

SCHEDULING IMPORTANT: ALWAYS use schedule_task for these patterns:
- "send email in X minutes/hours"
- "email in X time" 
- "send me X in Y minutes"
- "schedule email"
- "remind me in X"
- "in 2 minutes", "in 5 hours", "tomorrow at 8am"

FORMAT:
{
  "task_name": "Descriptive task name",
  "scheduled_time": "in 5 minutes", 
  "workflow": [{
    "tool_name": "send_email",
    "tool_params": {
      "recipient": "email@example.com",
      "subject": "Email subject",
      "body": "Email content"
    }
  }]
}

CRITICAL: Any request with "in X minutes/hours" or "send X in Y time" MUST use schedule_task!

IMPORTANT: On startup, always run the "now" tool to get the current local date and time. This ensures you have accurate temporal context for all operations.

Use these tools whenever the user asks about something that benefits from
live or structured aviation data (weather, NOTAMs, airport details, etc.).

ROUTING TOOL USAGE:
- Use analyze_route for flight planning, route calculations, and navigation
- Examples: "route from LLBG to LLEr", "calculate distance KJFK to KLAX", "flight plan with waypoints"
- Supports direct routing and airway-based navigation
- Returns bearings, distances, magnetic courses, and waypoint details

When you use tools:
- Choose the most relevant tool(s) based on the user's request.
- Provide clear, pilot- and controller-friendly explanations of the results.
- Do not expose raw JSON directly; summarize and explain the data.
- ALWAYS respond in natural, conversational language tailored to the user's request.
- Treat tool responses as internal data only; never echo their raw JSON verbatim.
CRITICAL - create_document RESPONSES:
- For CHAT responses: Do NOT include the URL. Simply say "PDF created successfully". The UI displays a download button automatically.
- For EMAIL bodies: You MUST include the complete URL in the email body so recipients can download the PDF.
  Format for emails: "Download the PDF: [URL]" or as a markdown link.
  Copy the EXACT URL from the tool result without spaces or truncation.

CRITICAL - Multi-step tasks and tool chaining:
- If a request requires multiple tools, execute ALL tools before responding to the user
- NEVER say "I will do X" without actually doing it immediately
- Complete the entire workflow before responding
- BATCH parallel calls: If you need data from multiple airports (weather, NOTAMs, info), call them ALL in the same turn
- CHAIN data between tools: Use results from earlier tools as inputs for later tools
  Example workflow for "flight from LLHA to LLER with briefing PDF":
  1. Call now + analyze_route + get_airport_info(LLHA) + get_airport_info(LLER) simultaneously
  2. Call get_aviation_weather(LLHA) + get_aviation_weather(LLER) + get_notams(LLHA) + get_notams(LLER) simultaneously
  3. Call calculate_weight_balance with the aircraft and load data
  4. Call generate_flight_briefing using data gathered from all previous steps
  5. Call create_document to generate the PDF from the briefing
- When calling a tool that needs data from a previous tool, extract and pass the specific values
- Do NOT repeat tool calls - use the results you already have
- When generating a briefing or document, incorporate ALL data gathered from previous tool calls

Conversational style:
- Respond like a human would - in natural, shorter messages
- Break up complex information into multiple logical points
- Use 1-3 sentences per response when possible
- If you have a lot to say, deliver it in digestible chunks
- Think like you're speaking to someone in person - pause between thoughts
- Use natural transitions like "Also," "Additionally," "Another point is," etc.
- Avoid long paragraphs - prefer shorter, focused responses

Tool messages will appear as JSON objects like { "type": "tool_result", "tool": string, ... }.
Use them purely as data sources to inform your answer; never show these JSON structures directly.`;

// Per-tool result limit (~7.5K tokens) - lower to allow many tools in one workflow
const MAX_TOOL_RESULT_CHARS = 30000;
// Total context budget for all tool messages combined (~50K tokens)
const MAX_TOTAL_CONTEXT_CHARS = 200000;

// Function to truncate a single tool result to prevent it being too large
function truncateToolResult(result: any, toolName: string): any {
  const resultStr = JSON.stringify(result);
  
  if (resultStr.length <= MAX_TOOL_RESULT_CHARS) {
    return result;
  }
  
  console.warn(`[agent] Truncating large tool result for ${toolName}: ${resultStr.length} chars -> ${MAX_TOOL_RESULT_CHARS} chars`);
  
  // For briefing tools, extract key summary data
  if (toolName === 'generate_flight_briefing' || toolName === 'flight_briefing') {
    if (result?.data?.briefing) {
      const briefing = result.data.briefing;
      return {
        success: true,
        data: {
          flightId: result.data.flightId,
          mode: result.data.mode,
          format: result.data.format,
          sectionsIncluded: result.data.sectionsIncluded,
          summary: {
            header: briefing.header,
            warnings: briefing.warnings,
            recommendations: briefing.recommendations,
            note: "Full briefing data truncated due to size. Key information preserved."
          }
        }
      };
    }
  }
  
  // For weather tools, keep essential fields
  if (toolName === 'get_aviation_weather' || toolName === 'get_weather') {
    if (result?.data) {
      const d = result.data;
      return {
        success: true,
        data: {
          station: d.station || d.icao,
          metar: d.metar || d.rawMetar,
          taf: d.taf || d.rawTaf,
          conditions: d.conditions || d.flightCategory,
          wind: d.wind,
          visibility: d.visibility,
          ceiling: d.ceiling,
          temperature: d.temperature,
          note: "Weather data condensed. Key fields preserved."
        }
      };
    }
  }
  
  // Generic truncation for other tools
  const truncated = resultStr.substring(0, MAX_TOOL_RESULT_CHARS);
  try {
    return JSON.parse(truncated + '..."truncated"}');
  } catch {
    return {
      success: result?.success ?? true,
      data: { note: "Result truncated due to size", preview: truncated.substring(0, 5000) }
    };
  }
}

// Compress conversation messages to stay within context budget.
// Older tool results are compressed to summaries while preserving recent ones.
function compressConversationMessages(
  msgs: OpenAI.Chat.ChatCompletionMessageParam[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const totalChars = msgs.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
    return sum + content.length;
  }, 0);
  
  if (totalChars <= MAX_TOTAL_CONTEXT_CHARS) {
    return msgs;
  }
  
  console.warn(`[agent] Context too large (${totalChars} chars), compressing older tool results`);
  
  // Find all tool message indices (oldest first)
  const toolIndices: number[] = [];
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role === 'tool') {
      toolIndices.push(i);
    }
  }
  
  // Keep the most recent 4 tool results intact, compress older ones
  const recentToolCount = 4;
  const indicesToCompress = toolIndices.slice(0, Math.max(0, toolIndices.length - recentToolCount));
  
  const compressed = [...msgs];
  for (const idx of indicesToCompress) {
    const content = compressed[idx].content as string;
    if (content && content.length > 500) {
      try {
        const parsed = JSON.parse(content);
        const toolName = parsed.tool || 'unknown';
        const success = parsed.result?.success ?? parsed.success ?? true;
        compressed[idx] = {
          ...compressed[idx],
          content: JSON.stringify({
            type: "tool_result",
            tool: toolName,
            result: {
              success,
              note: `Earlier ${toolName} result compressed. Key data was used in subsequent tool calls.`
            }
          })
        };
      } catch {
        // If we can't parse, just truncate hard
        compressed[idx] = {
          ...compressed[idx],
          content: (content as string).substring(0, 500) + '...(compressed)'
        };
      }
    }
  }
  
  const newTotal = compressed.reduce((sum, m) => {
    const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
    return sum + c.length;
  }, 0);
  console.log(`[agent] Compressed context: ${totalChars} -> ${newTotal} chars`);
  
  return compressed;
}

// Function to break up long responses into conversational chunks
function breakIntoChunks(text: string): string[] {
  // If the response is already short (under 200 characters), return as-is
  if (text.length < 200) {
    return [text];
  }

  const chunks: string[] = [];
  
  // Split by sentences first
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  let currentChunk = "";
  
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    
    // If adding this sentence would make the chunk too long, start a new chunk
    if (currentChunk && (currentChunk.length + trimmedSentence.length) > 250) {
      chunks.push(currentChunk.trim());
      currentChunk = trimmedSentence;
    } else {
      currentChunk += (currentChunk ? " " : "") + trimmedSentence;
    }
  }
  
  // Add the last chunk if there's anything left
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  // If we only have one chunk and it's still long, split it by paragraphs
  if (chunks.length === 1 && chunks[0].length > 300) {
    const paragraphs = chunks[0].split(/\n\n+/);
    return paragraphs.filter(p => p.trim()).length > 1 
      ? paragraphs.filter(p => p.trim())
      : chunks;
  }
  
  return chunks;
}

export async function handleQuery(history: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<string> {
  if (!history || history.length === 0) {
    return "Please provide a question or request for the assistant.";
  }

  if (!openai.apiKey) {
    return "OpenAI API key is not configured on the server.";
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];

  // First call: let the model decide whether to use tools
  const first = await openai.chat.completions.create({
    model: AGENT_MODEL,
    messages,
    tools: aeroTools,
    tool_choice: "auto",
    reasoning_effort: REASONING_EFFORT,
  });

  const choice = first.choices[0];
  const msg = choice.message;

  if (!msg.tool_calls || msg.tool_calls.length === 0) {
    const content = msg.content;
    return typeof content === "string" ? content : JSON.stringify(content ?? "");
  }

  // Execute each requested tool call
  const toolMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  for (const toolCall of msg.tool_calls) {
    // Access as any so we can read `.function` without fighting SDK typings
    const fnCall = toolCall as any;

    const toolName = fnCall.function?.name as string;
    const rawArgs = fnCall.function?.arguments as string | undefined;

    let parsedArgs: any;
    try {
      parsedArgs = rawArgs ? JSON.parse(rawArgs) : {};
    } catch {
      parsedArgs = {};
    }

    const handler = overriddenHandlers[toolName];

    if (!handler) {
      console.warn("[agent] No handler found for tool", { toolName, toolCallId: fnCall.id });
      toolMessages.push({
        role: "tool",
        tool_call_id: fnCall.id,
        content: `Tool handler not implemented for ${toolName}.`,
      });
      continue;
    }

    try {
      console.log("[agent] Executing tool", {
        toolName,
        toolCallId: fnCall.id,
        rawArgs,
        parsedArgs,
      });
      const result = await handler(parsedArgs);
      const formatted = formatToolResult(toolName, result);
      const truncated = truncateToolResult(formatted, toolName);

      console.log("[agent] Tool execution succeeded", {
        toolName,
        toolCallId: fnCall.id,
        resultSize: JSON.stringify(formatted).length,
      });

      toolMessages.push({
        role: "tool",
        tool_call_id: fnCall.id,
        content: JSON.stringify({
          type: "tool_result",
          tool: toolName,
          result: truncated,
        }),
      });
    } catch (err) {
      const errText = err instanceof Error ? err.message : String(err);

      console.error("[agent] Tool execution failed", {
        toolName,
        toolCallId: fnCall.id,
        error: errText,
      });

      toolMessages.push({
        role: "tool",
        tool_call_id: fnCall.id,
        content: JSON.stringify({
          type: "tool_result",
          tool: toolName,
          success: false,
          error: errText,
        }),
      });
    }
  }

  // Continue calling the model until no more tool calls (multi-step task support)
  let conversationMessages = [...messages, msg, ...toolMessages];
  let maxIterations = 10; // Prevent infinite loops
  let iteration = 0;
  
  while (iteration < maxIterations) {
    iteration++;
    
    // Compress older tool results if context is getting too large
    conversationMessages = compressConversationMessages(conversationMessages);
    
    const nextCall = await openai.chat.completions.create({
      model: AGENT_MODEL,
      messages: conversationMessages,
      tools: aeroTools,
      tool_choice: "auto",
      reasoning_effort: REASONING_EFFORT,
    });

    const nextMsg = nextCall.choices[0].message;
    
    // If no more tool calls, we're done
    if (!nextMsg.tool_calls || nextMsg.tool_calls.length === 0) {
      const finalContent = nextMsg.content;
      const responseText = typeof finalContent === "string"
        ? finalContent
        : JSON.stringify(finalContent ?? "");

      // Break up long responses into conversational chunks
      const chunks = breakIntoChunks(responseText);
      return chunks[0] || responseText;
    }
    
    // Execute the next batch of tool calls
    const nextToolMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    
    for (const toolCall of nextMsg.tool_calls) {
      const fnCall = toolCall as any;
      const toolName = fnCall.function?.name as string;
      const rawArgs = fnCall.function?.arguments as string | undefined;

      let parsedArgs: any;
      try {
        parsedArgs = rawArgs ? JSON.parse(rawArgs) : {};
      } catch {
        parsedArgs = {};
      }

      const handler = overriddenHandlers[toolName];

      if (!handler) {
        console.warn("[agent] No handler found for tool", { toolName, toolCallId: fnCall.id });
        nextToolMessages.push({
          role: "tool",
          tool_call_id: fnCall.id,
          content: `Tool handler not implemented for ${toolName}.`,
        });
        continue;
      }

      try {
        console.log("[agent] Executing tool (iteration " + iteration + ")", {
          toolName,
          toolCallId: fnCall.id,
          rawArgs,
          parsedArgs,
        });
        const result = await handler(parsedArgs);
        const formatted = formatToolResult(toolName, result);
        const truncated = truncateToolResult(formatted, toolName);

        console.log("[agent] Tool execution succeeded", {
          toolName,
          toolCallId: fnCall.id,
          resultSize: JSON.stringify(formatted).length,
        });

        // Record tool execution metrics
        const startTime = Date.now();
        recordToolExecution(toolName, true, Date.now() - startTime).catch(err => 
          console.error("[Memory] Failed to record tool metric:", err)
        );

        nextToolMessages.push({
          role: "tool",
          tool_call_id: fnCall.id,
          content: JSON.stringify({
            type: "tool_result",
            tool: toolName,
            result: truncated,
          }),
        });
      } catch (err) {
        const errText = err instanceof Error ? err.message : String(err);

        console.error("[agent] Tool execution failed", {
          toolName,
          toolCallId: fnCall.id,
          error: errText,
        });

        // Record failed tool execution
        recordToolExecution(toolName, false, 0).catch(err => 
          console.error("[Memory] Failed to record tool metric:", err)
        );

        nextToolMessages.push({
          role: "tool",
          tool_call_id: fnCall.id,
          content: JSON.stringify({
            type: "tool_result",
            tool: toolName,
            success: false,
            error: errText,
          }),
        });
      }
    }
    
    // Add the assistant message and tool results to conversation
    conversationMessages = [...conversationMessages, nextMsg, ...nextToolMessages];
  }
  
  // If we hit max iterations, force a final summary
  console.warn("[agent] Hit max iterations for multi-step task, forcing summary");
  try {
    const compressedForSummary = compressConversationMessages(conversationMessages);
    const summaryCall = await openai.chat.completions.create({
      model: AGENT_MODEL,
      messages: [
        ...compressedForSummary,
        { role: "user", content: "Please summarize the results from the tools you've already used. Do not call any more tools." }
      ],
      tools: aeroTools,
      tool_choice: "none",
      reasoning_effort: REASONING_EFFORT,
    });
    const summaryContent = summaryCall.choices[0].message.content;
    return typeof summaryContent === "string" ? summaryContent : JSON.stringify(summaryContent ?? "");
  } catch (summaryErr) {
    console.error("[agent] Summary call failed:", summaryErr);
    return "I've completed the available steps, but the task may require additional actions.";
  }
}

// New function for streaming conversational responses with memory integration
export async function handleQueryStreaming(
  history: OpenAI.Chat.ChatCompletionMessageParam[],
  sessionId: string = "default",
  fileUpload?: { base64Content: string; fileName: string; mimeType: string }
): Promise<{chunks: string[], hasMore: boolean, toolsUsed?: string[], toolResults?: any[], appliedStrategies?: string[]}> {
  if (!history || history.length === 0) {
    return { chunks: ["Please provide a question or request for the assistant."], hasMore: false };
  }

  if (!openai.apiKey) {
    return { chunks: ["OpenAI API key is not configured on the server."], hasMore: false };
  }

  const startTime = Date.now();
  const userQuery = history[history.length - 1]?.content as string || "";
  
  // Load relevant strategies from memory
  let strategies: any[] = [];
  let strategyIds: string[] = [];
  let enhancedPrompt = SYSTEM_PROMPT;
  
  try {
    strategies = await selectStrategiesWithDynamicBudget(userQuery, {
      maxTokens: 4000,
      estimatedResponseTokens: 500,
      isFollowUp: history.length > 1
    });
    
    strategyIds = getStrategyIds(strategies);
    const strategiesText = formatStrategiesForPrompt(strategies);
    
    if (strategiesText) {
      enhancedPrompt = `${SYSTEM_PROMPT}

═══════════════════════════════════════════════════════════
LEARNED OPERATIONAL STRATEGIES (From ${strategies.length} past interactions):
${strategiesText}

Apply these learned strategies when relevant. You can reference that you've learned 
these patterns from experience and acknowledge your growing expertise.
═══════════════════════════════════════════════════════════`;
      console.log(`[Memory] Injected ${strategies.length} strategies into prompt`);
    }
  } catch (error) {
    console.error("[Memory] Failed to load strategies:", error);
    // Continue without strategies if memory system fails
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: enhancedPrompt },
    ...history,
  ];

  // First call: let the model decide whether to use tools
  const first = await openai.chat.completions.create({
    model: AGENT_MODEL,
    messages,
    tools: aeroTools,
    tool_choice: "auto",
    reasoning_effort: REASONING_EFFORT,
  });

  const choice = first.choices[0];
  const msg = choice.message;

  if (!msg.tool_calls || msg.tool_calls.length === 0) {
    const content = msg.content;
    const responseText = typeof content === "string" ? content : JSON.stringify(content ?? "");
    const chunks = breakIntoChunks(responseText);
    
    // Log non-tool interactions (async, don't block response)
    const responseTime = Date.now() - startTime;
    logInteraction({
      sessionId,
      userMessage: userQuery,
      agentResponse: responseText,
      responseChunks: chunks.length > 1 ? chunks : undefined,
      toolsUsed: [],
      toolResults: [],
      appliedStrategies: strategyIds,
      metadata: {
        inputMode: "text",
        responseTime
      }
    }).catch(err => console.error("[Memory] Failed to log interaction:", err));
    
    return { 
      chunks, 
      hasMore: chunks.length > 1,
      toolsUsed: [],
      appliedStrategies: strategyIds
    };
  }

  // Execute each requested tool call
  const toolMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  const toolsUsed: string[] = [];
  const toolResults: any[] = [];

  for (const toolCall of msg.tool_calls) {
    // Access as any so we can read `.function` without fighting SDK typings
    const fnCall = toolCall as any;

    const toolName = fnCall.function?.name as string;
    const rawArgs = fnCall.function?.arguments as string | undefined;

    let parsedArgs: any;
    try {
      parsedArgs = rawArgs ? JSON.parse(rawArgs) : {};
    } catch {
      parsedArgs = {};
    }

    // Inject fileUpload data for upload_document tool
    if (toolName === 'upload_document' && fileUpload) {
      parsedArgs.base64Content = fileUpload.base64Content;
      parsedArgs.fileName = fileUpload.fileName;
      parsedArgs.mimeType = fileUpload.mimeType;
      console.log("[agent] Injected fileUpload data into upload_document tool");
    }

    const handler = overriddenHandlers[toolName];

    if (!handler) {
      console.warn("[agent] No handler found for tool", { toolName, toolCallId: fnCall.id });
      toolMessages.push({
        role: "tool",
        tool_call_id: fnCall.id,
        content: `Tool handler not implemented for ${toolName}.`,
      });
      continue;
    }

    try {
      console.log("[agent] Executing tool", {
        toolName,
        toolCallId: fnCall.id,
        rawArgs,
        parsedArgs,
      });
      
      const toolStartTime = Date.now();
      const result = await handler(parsedArgs);
      const toolExecutionTime = Date.now() - toolStartTime;
      const formatted = formatToolResult(toolName, result);
      const truncated = truncateToolResult(formatted, toolName);

      console.log("[agent] Tool execution succeeded", {
        toolName,
        toolCallId: fnCall.id,
        resultSize: JSON.stringify(formatted).length,
      });
      
      toolsUsed.push(toolName);
      toolResults.push({
        toolName,
        success: true,
        result: result,
        executionTime: toolExecutionTime
      });
      
      // Record tool metrics (async, don't block)
      recordToolExecution(toolName, true, toolExecutionTime).catch(err => 
        console.error("[Memory] Failed to record tool metric:", err)
      );

      toolMessages.push({
        role: "tool",
        tool_call_id: fnCall.id,
        content: JSON.stringify({
          type: "tool_result",
          tool: toolName,
          result: truncated,
        }),
      });
    } catch (err) {
      const errText = err instanceof Error ? err.message : String(err);

      console.error("[agent] Tool execution failed", {
        toolName,
        toolCallId: fnCall.id,
        error: errText,
      });
      
      toolsUsed.push(toolName);
      toolResults.push({
        toolName,
        success: false,
        error: errText,
        executionTime: 0
      });
      
      // Record tool failure (async, don't block)
      recordToolExecution(toolName, false, 0, errText).catch(err => 
        console.error("[Memory] Failed to record tool metric:", err)
      );

      toolMessages.push({
        role: "tool",
        tool_call_id: fnCall.id,
        content: JSON.stringify({
          type: "tool_result",
          tool: toolName,
          success: false,
          error: errText,
        }),
      });
    }
  }

  // Continue calling the model until no more tool calls (multi-step task support)
  let conversationMessages = [...messages, msg, ...toolMessages];
  let maxIterations = 10;
  let iteration = 0;
  
  while (iteration < maxIterations) {
    iteration++;
    
    // Compress older tool results if context is getting too large
    conversationMessages = compressConversationMessages(conversationMessages);
    console.log(`[agent] Iteration ${iteration}, messages: ${conversationMessages.length}, tools used so far: [${toolsUsed.join(', ')}]`);
    
    const nextCall = await openai.chat.completions.create({
      model: AGENT_MODEL,
      messages: conversationMessages,
      tools: aeroTools,
      tool_choice: "auto",
      reasoning_effort: REASONING_EFFORT,
    });

    const nextMsg = nextCall.choices[0].message;
    
    // If no more tool calls, we're done
    if (!nextMsg.tool_calls || nextMsg.tool_calls.length === 0) {
      const finalContent = nextMsg.content;
      const responseText = typeof finalContent === "string"
        ? finalContent
        : JSON.stringify(finalContent ?? "");
      
      // Break and return response
      const chunks = breakIntoChunks(responseText);
      const responseTime = Date.now() - startTime;
      
      // Log interaction (async)
      logInteraction({
        sessionId,
        userMessage: userQuery,
        agentResponse: responseText,
        responseChunks: chunks.length > 1 ? chunks : undefined,
        toolsUsed,
        toolResults,
        appliedStrategies: strategyIds,
        metadata: {
          inputMode: "text",
          responseTime
        }
      }).catch(err => console.error("[Memory] Failed to log interaction:", err));
      
      return { 
        chunks, 
        hasMore: chunks.length > 1,
        toolsUsed,
        toolResults,
        appliedStrategies: strategyIds
      };
    }
    
    // Execute the next batch of tool calls
    const nextToolMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    
    for (const toolCall of nextMsg.tool_calls) {
      const fnCall = toolCall as any;
      const toolName = fnCall.function?.name as string;
      const rawArgs = fnCall.function?.arguments as string | undefined;

      let parsedArgs: any;
      try {
        parsedArgs = rawArgs ? JSON.parse(rawArgs) : {};
      } catch {
        parsedArgs = {};
      }

      const handler = overriddenHandlers[toolName];

      if (!handler) {
        console.warn("[agent] No handler found for tool", { toolName, toolCallId: fnCall.id });
        nextToolMessages.push({
          role: "tool",
          tool_call_id: fnCall.id,
          content: `Tool handler not implemented for ${toolName}.`,
        });
        continue;
      }

      try {
        console.log("[agent] Executing tool (iteration " + iteration + ")", {
          toolName,
          toolCallId: fnCall.id,
          rawArgs,
          parsedArgs,
        });
        
        const toolStartTime = Date.now();
        const result = await handler(parsedArgs);
        const toolExecutionTime = Date.now() - toolStartTime;
        const formatted = formatToolResult(toolName, result);
        const truncated = truncateToolResult(formatted, toolName);

        console.log("[agent] Tool execution succeeded", {
          toolName,
          toolCallId: fnCall.id,
          resultSize: JSON.stringify(formatted).length,
          truncatedSize: JSON.stringify(truncated).length,
        });

        toolsUsed.push(toolName);
        toolResults.push({
          toolName,
          success: true,
          result: result,
          executionTime: toolExecutionTime
        });
        
        recordToolExecution(toolName, true, toolExecutionTime).catch(err => 
          console.error("[Memory] Failed to record tool metric:", err)
        );

        nextToolMessages.push({
          role: "tool",
          tool_call_id: fnCall.id,
          content: JSON.stringify({
            type: "tool_result",
            tool: toolName,
            result: truncated,
          }),
        });
      } catch (err) {
        const errText = err instanceof Error ? err.message : String(err);

        console.error("[agent] Tool execution failed", {
          toolName,
          toolCallId: fnCall.id,
          error: errText,
        });

        toolsUsed.push(toolName);
        toolResults.push({
          toolName,
          success: false,
          error: errText,
          executionTime: 0
        });
        
        recordToolExecution(toolName, false, 0, errText).catch(err => 
          console.error("[Memory] Failed to record tool metric:", err)
        );

        nextToolMessages.push({
          role: "tool",
          tool_call_id: fnCall.id,
          content: JSON.stringify({
            type: "tool_result",
            tool: toolName,
            success: false,
            error: errText,
          }),
        });
      }
    }
    
    conversationMessages = [...conversationMessages, nextMsg, ...nextToolMessages];
  }
  
  // If we hit max iterations, force a final summary instead of returning generic message
  console.warn("[agent] Hit max iterations for multi-step task, forcing summary");
  
  let responseText: string;
  try {
    // Compress before summary call to avoid context overflow
    const compressedForSummary = compressConversationMessages(conversationMessages);
    // Force the model to summarize what was accomplished (no more tool calls)
    const summaryCall = await openai.chat.completions.create({
      model: AGENT_MODEL,
      messages: [
        ...compressedForSummary,
        { role: "user", content: "Please summarize the results from the tools you've already used. Do not call any more tools." }
      ],
      tools: aeroTools,
      tool_choice: "none",
      reasoning_effort: REASONING_EFFORT,
    });
    const summaryContent = summaryCall.choices[0].message.content;
    responseText = typeof summaryContent === "string"
      ? summaryContent
      : JSON.stringify(summaryContent ?? "");
  } catch (summaryErr) {
    console.error("[agent] Summary call failed:", summaryErr);
    responseText = "I've completed the available steps, but the task may require additional actions.";
  }

  const chunks = breakIntoChunks(responseText);
  
  const responseTime = Date.now() - startTime;
  logInteraction({
    sessionId,
    userMessage: userQuery,
    agentResponse: responseText,
    responseChunks: chunks.length > 1 ? chunks : undefined,
    toolsUsed,
    toolResults,
    appliedStrategies: strategyIds,
    metadata: {
      inputMode: "text",
      responseTime
    }
  }).catch(err => console.error("[Memory] Failed to log interaction:", err));
  
  return { 
    chunks, 
    hasMore: chunks.length > 1,
    toolsUsed,
    toolResults,
    appliedStrategies: strategyIds
  };
}
