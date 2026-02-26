import OpenAI from "openai";
import { tools as aeroTools, handlers, formatToolResult } from "@orad86/ai-aero-tools";
import { createDocumentWrapper } from "../tools/create-document-wrapper";
import { selectStrategiesWithDynamicBudget, formatStrategiesForPrompt, getStrategyIds } from "../memory/injection";
import { logInteraction } from "../memory/log-interaction";
import { WorkingMemory } from "../memory/working-memory";
import { executeWithProxy } from "../memory/tool-proxy";
import { EpisodicMemory, ToolAction } from "../memory/episodic-memory";
import { assembleContext } from "../memory/context-assembler";
import { getUserPreferencesStore } from "../memory/user-preferences";
import { WorkflowTemplateStore } from "../memory/workflow-templates";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Model configuration
const TOOL_MODEL = "gpt-5-mini"; // Fast model for tool dispatch
const FINAL_MODEL = "gpt-5"; // Full model for final user-facing synthesis
// Low reasoning for tool dispatch (fast), medium for final user-facing synthesis
const TOOL_REASONING: "low" | "medium" | "high" = "low";
const FINAL_REASONING: "low" | "medium" | "high" = "medium";

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

CRITICAL - DOCUMENT TOOLS (generate_flight_briefing, generate_nav_log, calculate_weight_balance, format_flight_plan):
- These tools produce COMPLETE pre-formatted documents (marked with _hasFormattedDocument: true)
- Do NOT recreate, reformat, or rewrite their content in your response
- To create a PDF from the formatted document, call create_document with EXACTLY: content="USE_FORMATTED_HTML", format="html"
- The system will automatically inject the real HTML — you do NOT need to provide it
- Do NOT write your own HTML or try to recreate the document content
- In your chat response, give a SHORT summary (2-3 sentences) of the key findings
- Example: "Your flight briefing is ready. Key highlights: winds 270/15, CAVOK at both airports, no significant NOTAMs. Creating the PDF now..."

CRITICAL - STANDALONE TOOL ARCHITECTURE (v1.0.0):
Tools do NOT call each other internally. YOU are the sole orchestrator. Each tool is a pure function that requires all its data as parameters. You must:
1. Call prerequisite tools first to gather data
2. Extract the needed values from their results
3. Pass those values as parameters to dependent tools

KEY DATA DEPENDENCIES — follow these patterns:

generate_nav_log REQUIRES:
- waypoints: array of {identifier, latitude, longitude, type} — call get_airport_info for airports and get_waypoint_data for waypoints first
- tasKnots: from get_aircraft_performance → cruise_speed_knots
- fuelFlowPph: from get_aircraft_performance → fuel_flow.cruise_pph
- winds: from get_winds_aloft → array of {direction, speed}
- departureElevationFt/destinationElevationFt: from get_airport_info → elevation

generate_flight_briefing REQUIRES:
- flightId: from create_flight result — you MUST call create_flight BEFORE generate_flight_briefing
- prefetchedData with:
  - departure/destination/alternate: {airportInfo, weather, notams, runwayInUse} — from get_airport_info, get_aviation_weather_data, get_notams, get_runway_in_use
  - navLog: from generate_nav_log result
  - weightBalance: from calculate_weight_balance result (pass the FULL result object, not just {_hasFormattedDocument: true})

get_runway_in_use REQUIRES: airportLat, airportLon, runways (from get_airport_info), metar (from get_aviation_weather_data)
find_alternate_airports REQUIRES: airportLat, airportLon (from get_airport_info)
get_traffic_flow / get_runway_queue REQUIRES: airportLat, airportLon (from get_airport_info)
get_procedure_in_use REQUIRES: airportLat, airportLon (from get_airport_info), landingRunways/takeoffRunways (from get_runway_in_use)
detect_weather_anomalies REQUIRES: metar, taf (from get_aviation_weather_data)
get_cloud_base_forecast REQUIRES: cloudLayers (from get_general_weather_forecast)

EXAMPLE WORKFLOW — Flight Briefing:
Turn 1: Batch call get_airport_info (dep + dest), get_aviation_weather_data (dep + dest), get_aircraft_performance
Turn 2: Call get_notams (dep + dest), get_runway_in_use (pass airport coords + runways + metar), get_winds_aloft (pass route coords)
Turn 3: Call generate_nav_log (pass waypoints, TAS, fuel flow, winds, elevations)
Turn 4: Call calculate_weight_balance, then create_flight (to get a valid flightId)
Turn 5: Call generate_flight_briefing (pass flightId from create_flight + ALL collected data as prefetchedData)

CRITICAL - Multi-step tasks and tool chaining:
- If a request requires multiple tools, execute ALL tools before responding to the user
- NEVER say "I will do X" without actually doing it immediately — do it now
- Complete the entire workflow before responding
- PLAN first: mentally break the task into steps and identify which tools are needed and in what order
- BATCH independent calls: if multiple tools can run in parallel (e.g., info for two airports, weather for two locations), call them ALL in the same turn
- CHAIN data between tools: use results from earlier tools as inputs for later tools — extract and pass the specific values needed
- Do NOT repeat tool calls — use the results you already have
- SYNTHESIZE: when generating a final output (briefing, document, email, summary), incorporate ALL relevant data gathered from previous tool calls
- Be flexible: adapt your tool selection and order to the specific request — there is no single fixed workflow

Conversational style:
- Respond like a human would - in natural, shorter messages
- Break up complex information into multiple logical points
- Use 1-3 sentences per response when possible
- If you have a lot to say, deliver it in digestible chunks
- Think like you're speaking to someone in person - pause between thoughts
- Use natural transitions like "Also," "Additionally," "Another point is," etc.
- Avoid long paragraphs - prefer shorter, focused responses

FORMATTING RULES (STRICT - your output is rendered with ReactMarkdown):
- Use standard markdown: **bold**, *italic*, # headings, - bullet lists, 1. numbered lists
- Use markdown links: [text](url)
- For data tables use markdown tables with | pipes
- Do NOT use HTML tags — use markdown equivalents instead
- Do NOT use LaTeX or non-standard markdown extensions
- Keep paragraphs short with blank lines between them
- Use code blocks with backticks only for actual code or ICAO identifiers

Tool messages will appear as JSON objects like { "type": "tool_result", "tool": string, ... }.
Use them purely as data sources to inform your answer; never show these JSON structures directly.`;

// ─── Session-scoped Working Memory ───────────────────────────
// Replaces the old briefingDataCache with a generic, tool-agnostic cache
// that supports TTL, data lineage, and dependency-based invalidation.
const sessionWorkingMemory = new Map<string, WorkingMemory>();
const sessionEpisodicMemory = new Map<string, EpisodicMemory>();
const sessionWorkflowTemplates = new Map<string, WorkflowTemplateStore>();

function getWorkingMemory(sessionId: string): WorkingMemory {
  let wm = sessionWorkingMemory.get(sessionId);
  if (!wm) {
    wm = new WorkingMemory();
    sessionWorkingMemory.set(sessionId, wm);
    console.log(`[agent] Created new WorkingMemory for session ${sessionId}`);
  }
  return wm;
}

function getEpisodicMemory(sessionId: string): EpisodicMemory {
  let em = sessionEpisodicMemory.get(sessionId);
  if (!em) {
    em = new EpisodicMemory();
    sessionEpisodicMemory.set(sessionId, em);
    console.log(`[agent] Created new EpisodicMemory for session ${sessionId}`);
  }
  return em;
}

function getWorkflowTemplates(sessionId: string): WorkflowTemplateStore {
  let wt = sessionWorkflowTemplates.get(sessionId);
  if (!wt) {
    wt = new WorkflowTemplateStore();
    sessionWorkflowTemplates.set(sessionId, wt);
  }
  return wt;
}

// Auto-inject data from Working Memory into generate_flight_briefing's prefetchedData.
// The briefing tool is a formatter — WM has the full raw results, so always use those.
function autoInjectFromWorkingMemory(parsedArgs: any, wm: WorkingMemory): void {
  if (!parsedArgs.prefetchedData) parsedArgs.prefetchedData = {};
  const pre = parsedArgs.prefetchedData;
  const getData = (entry: any) => entry.result?.data || entry.result;
  const injected: string[] = [];

  // flightId — use create_flight result if available
  const flights = wm.getByTool("create_flight");
  if (flights.length > 0) {
    const id = getData(flights[flights.length - 1])?.id;
    if (id && parsedArgs.flightId !== id) {
      parsedArgs.flightId = id;
      injected.push(`flightId=${id}`);
    }
  }

  // navLog — always use full WM data
  const navLogs = wm.getByTool("generate_nav_log");
  if (navLogs.length > 0) {
    const d = getData(navLogs[navLogs.length - 1]);
    if (d?.legs?.length > 0) { pre.navLog = d; injected.push(`navLog(${d.legs.length} legs)`); }
  }

  // weightBalance — always use full WM data (model often passes partial summary)
  const wbs = wm.getByTool("calculate_weight_balance");
  if (wbs.length > 0) {
    const d = getData(wbs[wbs.length - 1]);
    if (d?.loadBreakdown) { pre.weightBalance = d; injected.push(`weightBalance(${Object.keys(d).length} keys)`); }
  }

  // chartsHtml — always use WM (model can't pass the full embedded HTML)
  const charts = wm.getByTool("format_weather_charts");
  if (charts.length > 0) {
    const html = charts[0].formattedHtml || getData(charts[0])?.formattedHtml;
    if (html && html.length > 1000) { parsedArgs.chartsHtml = html; injected.push(`chartsHtml(${html.length})`); }
  }

  // Airport data — get dep/dest ICAOs from the flight or navLog, then fill from WM
  const depIcao = pre.navLog?.flight?.departure?.toUpperCase()
    || (pre.navLog?.legs?.[0]?.from || '').toUpperCase();
  const destIcao = pre.navLog?.flight?.destination?.toUpperCase()
    || (pre.navLog?.legs?.[pre.navLog?.legs?.length - 1]?.to || '').toUpperCase();

  const airportEntries = wm.getByTool("get_airport_info");
  for (const entry of airportEntries) {
    const icao = (entry.inputArgs?.icao || '').toUpperCase();
    if (!icao) continue;
    const target = icao === depIcao ? 'departure' : icao === destIcao ? 'destination'
      : (!pre.alternate1 ? 'alternate1' : (!pre.alternate2 ? 'alternate2' : null));
    if (!target) continue;
    if (!pre[target]) pre[target] = {};
    const d = getData(entry);
    if (d) pre[target].airportInfo = { icao, name: d.name, elevation: d.elevation || d.elev, runways: d.runways };

    // Weather, NOTAMs, runway-in-use for this airport
    const byIcao = wm.getByIcao(icao);
    const wx = byIcao.find(e => e.toolName === 'get_aviation_weather_data');
    if (wx) { const wd = getData(wx); pre[target].weather = { metar: wd?.metar, taf: wd?.taf }; }
    const notam = byIcao.find(e => e.toolName === 'get_notams');
    if (notam) pre[target].notams = getData(notam);
    const rwy = byIcao.find(e => e.toolName === 'get_runway_in_use');
    if (rwy) { const rd = getData(rwy); pre[target].runwayInUse = typeof rd === 'string' ? rd : rd?.recommended || rd?.runway; }
    injected.push(`${target}(${icao})`);
  }

  if (injected.length > 0) console.log(`[working-memory] Auto-injected: ${injected.join(', ')}`);
}

// Find the most recent formattedHtml from Working Memory.
// Prefers generate_flight_briefing HTML over other tools (e.g. calculate_weight_balance)
// to avoid creating a W&B PDF when a briefing PDF was intended.
function findLatestFormattedHtml(wm: WorkingMemory): string | null {
  const allEntries = wm.getAll();
  let latest: { html: string; timestamp: number; toolName: string } | null = null;
  let latestBriefing: { html: string; timestamp: number } | null = null;

  for (const entry of allEntries) {
    if (entry.formattedHtml) {
      if (!latest || entry.timestamp > latest.timestamp) {
        latest = { html: entry.formattedHtml, timestamp: entry.timestamp, toolName: entry.toolName };
      }
      if (entry.toolName === 'generate_flight_briefing') {
        if (!latestBriefing || entry.timestamp > latestBriefing.timestamp) {
          latestBriefing = { html: entry.formattedHtml, timestamp: entry.timestamp };
        }
      }
    }
  }

  // Prefer briefing HTML when available (it's the "final" document that includes sub-documents)
  if (latestBriefing) {
    console.log(`[agent] Using formattedHtml from generate_flight_briefing (${latestBriefing.html.length} chars)`);
    return latestBriefing.html;
  }
  if (latest) {
    console.log(`[agent] Using formattedHtml from ${latest.toolName} (${latest.html.length} chars)`);
  }
  return latest?.html || null;
}

// Strip formattedHtml from tool results before sending to GPT.
// The actual HTML is already cached in Working Memory via the tool-proxy.
function stripHtmlFromToolResult(result: any): any {
  if (!result || typeof result !== 'object') return result;
  const cleaned = { ...result };
  if (cleaned.data && typeof cleaned.data === 'object') {
    const { formattedHtml, ...dataWithoutHtml } = cleaned.data;
    if (formattedHtml) {
      console.log(`[agent] Stripped formattedHtml (${formattedHtml.length} chars) from tool result`);
      cleaned.data = {
        ...dataWithoutHtml,
        _hasFormattedDocument: true,
        _documentNote: "A pre-formatted HTML document was generated and cached. To create a PDF, call create_document with content='USE_FORMATTED_HTML' and format='html'. The system will auto-inject the real HTML. Do NOT write your own HTML."
      };
    }
  }
  return cleaned;
}

// ─── Unified Tool Execution ──────────────────────────────────
// Single function that replaces all 4 duplicated tool execution blocks.
// Handles: cache check via proxy, auto-injection, formatting, metrics.
async function executeTool(
  toolName: string,
  parsedArgs: Record<string, any>,
  fnCallId: string,
  wm: WorkingMemory,
  fileUpload?: { base64Content: string; fileName: string; mimeType: string }
): Promise<{
  toolMessage: OpenAI.Chat.ChatCompletionToolMessageParam;
  toolUsed: string;
  toolResult: { toolName: string; inputArgs: Record<string, any>; success: boolean; result?: any; error?: string; executionTime: number; cached: boolean; decision: string };
}> {
  // 1. File upload injection
  if (toolName === 'upload_document' && fileUpload) {
    parsedArgs.base64Content = fileUpload.base64Content;
    parsedArgs.fileName = fileUpload.fileName;
    parsedArgs.mimeType = fileUpload.mimeType;
    console.log("[agent] Injected fileUpload data into upload_document tool");
  }

  // 2. Auto-inject from Working Memory for create_document
  if (toolName === 'create_document' && parsedArgs.content === 'USE_FORMATTED_HTML') {
    const cachedHtml = findLatestFormattedHtml(wm);
    if (cachedHtml) {
      parsedArgs.content = cachedHtml;
      console.log(`[agent] Auto-injected cached formattedHtml (${cachedHtml.length} chars) into create_document`);
    }
  }

  // 3. Auto-inject from Working Memory for generate_flight_briefing
  if (toolName === 'generate_flight_briefing') {
    autoInjectFromWorkingMemory(parsedArgs, wm);
  }

  const handler = overriddenHandlers[toolName];
  if (!handler) {
    console.warn("[agent] No handler found for tool", { toolName, toolCallId: fnCallId });
    return {
      toolMessage: {
        role: "tool" as const,
        tool_call_id: fnCallId,
        content: `Tool handler not implemented for ${toolName}.`,
      },
      toolUsed: toolName,
      toolResult: { toolName, inputArgs: parsedArgs, success: false, error: `No handler for ${toolName}`, executionTime: 0, cached: false, decision: "No handler found" },
    };
  }

  try {
    // 4. Execute through Tool Proxy (handles cache check + execution + metrics)
    const proxyResult = await executeWithProxy(toolName, parsedArgs, handler, wm);

    // 5. Format for LLM context (strip HTML, truncate)
    const formatted = formatToolResult(toolName, proxyResult.result);
    const stripped = stripHtmlFromToolResult(formatted);
    const truncated = truncateToolResult(stripped, toolName);

    // 6. Annotate if cached so LLM knows
    const resultPayload = proxyResult.cached
      ? { ...truncated, _cached: true, _cacheAge: `${Math.round((Date.now() - proxyResult.entry.timestamp) / 60_000)}m` }
      : truncated;

    console.log("[agent] Tool execution succeeded", {
      toolName,
      toolCallId: fnCallId,
      cached: proxyResult.cached,
      executionTime: proxyResult.executionTime,
      decision: proxyResult.decision,
      resultSize: JSON.stringify(formatted).length,
    });

    return {
      toolMessage: {
        role: "tool" as const,
        tool_call_id: fnCallId,
        content: JSON.stringify({
          type: "tool_result",
          tool: toolName,
          result: resultPayload,
        }),
      },
      toolUsed: toolName,
      toolResult: {
        toolName,
        inputArgs: parsedArgs,
        success: true,
        result: proxyResult.result,
        executionTime: proxyResult.executionTime,
        cached: proxyResult.cached,
        decision: proxyResult.decision,
      },
    };
  } catch (err) {
    const errText = err instanceof Error ? err.message : String(err);
    console.error("[agent] Tool execution failed", { toolName, toolCallId: fnCallId, error: errText });

    return {
      toolMessage: {
        role: "tool" as const,
        tool_call_id: fnCallId,
        content: JSON.stringify({
          type: "tool_result",
          tool: toolName,
          success: false,
          error: errText,
        }),
      },
      toolUsed: toolName,
      toolResult: { toolName, inputArgs: parsedArgs, success: false, error: errText, executionTime: 0, cached: false, decision: `Failed: ${errText}` },
    };
  }
}

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

  // Use a default WorkingMemory for the non-streaming path
  const wm = getWorkingMemory("default");
  wm.prune();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];

  // First call: let the model decide whether to use tools
  const first = await openai.chat.completions.create({
    model: TOOL_MODEL,
    messages,
    tools: aeroTools,
    tool_choice: "auto",
    reasoning_effort: TOOL_REASONING,
  });

  const choice = first.choices[0];
  const msg = choice.message;

  if (!msg.tool_calls || msg.tool_calls.length === 0) {
    const content = msg.content;
    return typeof content === "string" ? content : JSON.stringify(content ?? "");
  }

  // Execute each requested tool call via unified executeTool
  const toolMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  for (const toolCall of msg.tool_calls) {
    const fnCall = toolCall as any;
    const toolName = fnCall.function?.name as string;
    const rawArgs = fnCall.function?.arguments as string | undefined;

    let parsedArgs: any;
    try {
      parsedArgs = rawArgs ? JSON.parse(rawArgs) : {};
    } catch {
      parsedArgs = {};
    }

    console.log("[agent] Executing tool", { toolName, toolCallId: fnCall.id, parsedArgs });
    const { toolMessage } = await executeTool(toolName, parsedArgs, fnCall.id, wm);
    toolMessages.push(toolMessage);
  }

  // Continue calling the model until no more tool calls (multi-step task support)
  let conversationMessages = [...messages, msg, ...toolMessages];
  let maxIterations = 20;
  let iteration = 0;
  
  while (iteration < maxIterations) {
    iteration++;
    
    // Compress older tool results if context is getting too large
    conversationMessages = compressConversationMessages(conversationMessages);
    
    const nextCall = await openai.chat.completions.create({
      model: TOOL_MODEL,
      messages: conversationMessages,
      tools: aeroTools,
      tool_choice: "auto",
      reasoning_effort: TOOL_REASONING,
    });

    const nextMsg = nextCall.choices[0].message;
    
    // If no more tool calls, we're done
    if (!nextMsg.tool_calls || nextMsg.tool_calls.length === 0) {
      const finalContent = nextMsg.content;
      const responseText = typeof finalContent === "string"
        ? finalContent
        : JSON.stringify(finalContent ?? "");

      const chunks = breakIntoChunks(responseText);
      return chunks[0] || responseText;
    }
    
    // Execute the next batch of tool calls via unified executeTool
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

      console.log("[agent] Executing tool (iteration " + iteration + ")", { toolName, toolCallId: fnCall.id, parsedArgs });
      const { toolMessage } = await executeTool(toolName, parsedArgs, fnCall.id, wm);
      nextToolMessages.push(toolMessage);
    }
    
    conversationMessages = [...conversationMessages, nextMsg, ...nextToolMessages];
  }
  
  // If we hit max iterations, force a final summary
  console.warn("[agent] Hit max iterations for multi-step task, forcing summary");
  try {
    const compressedForSummary = compressConversationMessages(conversationMessages);
    const summaryCall = await openai.chat.completions.create({
      model: FINAL_MODEL,
      messages: [
        ...compressedForSummary,
        { role: "user", content: "Please summarize the results from the tools you've already used. Do not call any more tools." }
      ],
      tools: aeroTools,
      tool_choice: "none",
      reasoning_effort: FINAL_REASONING,
    });
    const summaryContent = summaryCall.choices[0].message.content;
    return typeof summaryContent === "string" ? summaryContent : JSON.stringify(summaryContent ?? "");
  } catch (summaryErr) {
    console.error("[agent] Summary call failed:", summaryErr);
    return "I've completed the available steps, but the task may require additional actions.";
  }
}

// Convert toolResults from executeTool into ToolAction[] for episodic memory
function toToolActions(toolResults: any[]): ToolAction[] {
  return toolResults.map(tr => ({
    toolName: tr.toolName,
    inputArgs: tr.inputArgs || {},
    outputSummary: tr.decision || (tr.success ? "success" : `failed: ${tr.error}`),
    success: tr.success,
    executionTime: tr.executionTime || 0,
    cached: tr.cached || false,
    decision: tr.decision || "",
    dataKeys: [],
  }));
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
  
  // Get session-scoped memories (persist across queries in same session)
  const wm = getWorkingMemory(sessionId);
  const em = getEpisodicMemory(sessionId);
  const wt = getWorkflowTemplates(sessionId);
  const prefs = getUserPreferencesStore();
  wm.prune(); // Remove expired/stale entries
  
  // Extract user preferences from the message (async, non-blocking)
  prefs.extractFromMessage(userQuery, sessionId).catch(err =>
    console.error("[Memory] Failed to extract preferences:", err)
  );

  // Learn workflow templates from accumulated episodes
  wt.learnFromEpisodes(em);

  // Detect if this is a correction of a previous episode
  const correctedEpisode = em.detectCorrection(userQuery);
  if (correctedEpisode) {
    em.addFeedback(userQuery);
    console.log(`[agent] Detected correction of episode ${correctedEpisode.id}`);
  }
  
  // Load relevant strategies from memory (L3: Semantic Memory)
  let strategies: any[] = [];
  let strategyIds: string[] = [];
  let strategiesText = "";
  
  try {
    strategies = await selectStrategiesWithDynamicBudget(userQuery, {
      maxTokens: 4000,
      estimatedResponseTokens: 500,
      isFollowUp: history.length > 1
    });
    
    strategyIds = getStrategyIds(strategies);
    strategiesText = formatStrategiesForPrompt(strategies);
  } catch (error) {
    console.error("[Memory] Failed to load strategies:", error);
  }

  // Assemble all memory levels into system prompt via Context Assembler
  const { systemPrompt: enhancedPrompt, totalInjectedChars } = await assembleContext(
    SYSTEM_PROMPT,
    userQuery,
    wm,
    em,
    strategies,
    strategiesText,
    prefs,
    wt
  );

  if (totalInjectedChars > 0) {
    console.log(`[Memory] Context assembled: ${totalInjectedChars} chars injected (WM=${wm.size}, EP=${em.size}, STRAT=${strategies.length}, PREF=${prefs.size}, WF=${wt.size})`);
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: enhancedPrompt },
    ...history,
  ];

  // First call: let the model decide whether to use tools
  const first = await openai.chat.completions.create({
    model: TOOL_MODEL,
    messages,
    tools: aeroTools,
    tool_choice: "auto",
    reasoning_effort: TOOL_REASONING,
  });

  const choice = first.choices[0];
  const msg = choice.message;

  if (!msg.tool_calls || msg.tool_calls.length === 0) {
    const content = msg.content;
    const responseText = typeof content === "string" ? content : JSON.stringify(content ?? "");
    const chunks = breakIntoChunks(responseText);
    
    const responseTime = Date.now() - startTime;

    // Record episode (no tools used)
    em.record(userQuery, [], responseTime);

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

  // Execute each requested tool call via unified executeTool
  const toolMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  const toolsUsed: string[] = [];
  const toolResults: any[] = [];

  for (const toolCall of msg.tool_calls) {
    const fnCall = toolCall as any;
    const toolName = fnCall.function?.name as string;
    const rawArgs = fnCall.function?.arguments as string | undefined;

    let parsedArgs: any;
    try {
      parsedArgs = rawArgs ? JSON.parse(rawArgs) : {};
    } catch {
      parsedArgs = {};
    }

    console.log("[agent] Executing tool", { toolName, toolCallId: fnCall.id, parsedArgs });
    const { toolMessage, toolUsed, toolResult } = await executeTool(toolName, parsedArgs, fnCall.id, wm, fileUpload);
    toolMessages.push(toolMessage);
    toolsUsed.push(toolUsed);
    toolResults.push(toolResult);
  }

  // Continue calling the model until no more tool calls (multi-step task support)
  let conversationMessages = [...messages, msg, ...toolMessages];
  let maxIterations = 20;
  let iteration = 0;
  
  while (iteration < maxIterations) {
    iteration++;
    
    // Compress older tool results if context is getting too large
    conversationMessages = compressConversationMessages(conversationMessages);
    console.log(`[agent] Iteration ${iteration}, messages: ${conversationMessages.length}, tools used so far: [${toolsUsed.join(', ')}], WM entries: ${wm.size}`);
    
    const nextCall = await openai.chat.completions.create({
      model: TOOL_MODEL,
      messages: conversationMessages,
      tools: aeroTools,
      tool_choice: "auto",
      reasoning_effort: TOOL_REASONING,
    });

    const nextMsg = nextCall.choices[0].message;
    
    // If no more tool calls, we're done
    if (!nextMsg.tool_calls || nextMsg.tool_calls.length === 0) {
      const finalContent = nextMsg.content;
      const responseText = typeof finalContent === "string"
        ? finalContent
        : JSON.stringify(finalContent ?? "");
      
      const chunks = breakIntoChunks(responseText);
      const responseTime = Date.now() - startTime;

      // Record episode with all tool actions
      em.record(userQuery, toToolActions(toolResults), responseTime);
      
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
    
    // Execute the next batch of tool calls via unified executeTool
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

      console.log("[agent] Executing tool (iteration " + iteration + ")", { toolName, toolCallId: fnCall.id, parsedArgs });
      const { toolMessage, toolUsed, toolResult } = await executeTool(toolName, parsedArgs, fnCall.id, wm, fileUpload);
      nextToolMessages.push(toolMessage);
      toolsUsed.push(toolUsed);
      toolResults.push(toolResult);
    }
    
    conversationMessages = [...conversationMessages, nextMsg, ...nextToolMessages];
  }
  
  // If we hit max iterations, force a final summary
  console.warn("[agent] Hit max iterations for multi-step task, forcing summary");
  
  let responseText: string;
  try {
    const compressedForSummary = compressConversationMessages(conversationMessages);
    const summaryCall = await openai.chat.completions.create({
      model: FINAL_MODEL,
      messages: [
        ...compressedForSummary,
        { role: "user", content: "Please summarize the results from the tools you've already used. Do not call any more tools." }
      ],
      tools: aeroTools,
      tool_choice: "none",
      reasoning_effort: FINAL_REASONING,
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

  // Record episode (max iterations path)
  em.record(userQuery, toToolActions(toolResults), responseTime);

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
