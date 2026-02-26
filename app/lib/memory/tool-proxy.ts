import { WorkingMemory, ToolResultEntry } from "./working-memory";
import { recordToolExecution } from "./tool-metrics";

// ─── Types ───────────────────────────────────────────────────

export interface ProxyResult {
  result: any;
  cached: boolean;
  entry: ToolResultEntry;
  executionTime: number;
  decision: string;           // rationale for episodic memory / debugging
  formattedHtml?: string;     // extracted from result if present
}

// ─── Configuration ───────────────────────────────────────────

// Tools with side effects — NEVER cached, always executed
const NO_CACHE_TOOLS = new Set([
  "create_document",
  "send_email",
  "schedule_task",
  "upload_document",
]);

// ─── Summary Generation ─────────────────────────────────────

/** Generate a 1-line summary of a tool result for context injection */
export function generateToolSummary(toolName: string, args: Record<string, any>, result: any): string {
  const data = result?.data || result;
  const icao = (args.icao || args.identifier || args.station || "").toString().toUpperCase();

  try {
    switch (toolName) {
      case "get_aviation_weather_data": {
        const metar = data?.metar?.raw || data?.rawMetar || "";
        const cat = data?.flightCategory || data?.conditions || "";
        return `${icao} weather: ${cat}${metar ? `, METAR: ${metar.slice(0, 60)}…` : ""}`;
      }
      case "get_airport_info": {
        const name = data?.name || data?.airportName || "";
        const elev = data?.elevation || data?.elevationFt || "";
        return `${icao}: ${name}${elev ? `, elev ${elev}ft` : ""}`;
      }
      case "get_notams": {
        const count = Array.isArray(data?.notams) ? data.notams.length : "?";
        return `${icao}: ${count} NOTAMs`;
      }
      case "get_winds_aloft": {
        const levels = Array.isArray(data?.winds) ? data.winds.length : "?";
        return `Winds aloft: ${levels} levels`;
      }
      case "get_aircraft_performance": {
        const type = data?.aircraftType || data?.type || args.aircraftType || "";
        return `Aircraft perf: ${type}`;
      }
      case "generate_nav_log": {
        const legs = data?.legs?.length || "?";
        const ete = data?.totalTime || data?.ete || "";
        return `Nav log: ${legs} legs${ete ? `, ETE ${ete}` : ""}`;
      }
      case "calculate_weight_balance": {
        const tow = data?.takeoffWeight || "";
        return `W&B: TOW ${tow}${data?.withinLimits === false ? " ⚠️ OVER LIMIT" : ""}`;
      }
      case "format_weather_charts": {
        const charts = Array.isArray(data?.charts) ? data.charts.length : "?";
        return `Weather charts: ${charts} formatted`;
      }
      case "get_runway_in_use": {
        const rwy = data?.runway || data?.activeRunway || "";
        return `${icao} runway in use: ${rwy}`;
      }
      case "generate_flight_briefing": {
        return `Flight briefing generated`;
      }
      case "analyze_route": {
        const dist = data?.totalDistance || data?.distance || "";
        return `Route analysis${dist ? `: ${dist} NM` : ""}`;
      }
      case "get_general_weather_forecast": {
        return `Weather forecast retrieved`;
      }
      case "now": {
        const time = data?.local || data?.utc || "";
        return `Current time: ${time}`;
      }
      default: {
        const success = result?.success !== false;
        return `${toolName}: ${success ? "success" : "failed"}`;
      }
    }
  } catch {
    return `${toolName}: completed`;
  }
}

// ─── Tool Proxy ──────────────────────────────────────────────

/**
 * Execute a tool call through the Working Memory proxy.
 * 
 * The proxy enforces cache policy at the SYSTEM level:
 * - Checks Working Memory for a valid cached result
 * - If cache hit: returns cached result (0ms, no API call)
 * - If cache miss: executes handler, stores result in Working Memory
 * - Side-effect tools (create_document, send_email, etc.) always execute
 * 
 * The LLM is INFORMED of cache decisions but does NOT control them.
 */
export async function executeWithProxy(
  toolName: string,
  parsedArgs: Record<string, any>,
  handler: (args: any) => Promise<any>,
  workingMemory: WorkingMemory
): Promise<ProxyResult> {
  const startTime = Date.now();
  const normalizedArgs = WorkingMemory.normalizeArgs(toolName, parsedArgs);

  // ── Side-effect tools: always execute, store result but don't cache-check ──
  if (NO_CACHE_TOOLS.has(toolName)) {
    const result = await handler(parsedArgs);
    const execTime = Date.now() - startTime;
    const summary = generateToolSummary(toolName, parsedArgs, result);
    const formattedHtml = result?.data?.formattedHtml || undefined;
    const entry = workingMemory.set(toolName, normalizedArgs, result, summary, formattedHtml);

    // Record metrics (async)
    recordToolExecution(toolName, true, execTime).catch(err =>
      console.error("[tool-proxy] Failed to record metric:", err)
    );

    return {
      result,
      cached: false,
      entry,
      executionTime: execTime,
      decision: `Executed ${toolName} (side-effect tool, never cached)`,
      formattedHtml,
    };
  }

  // ── Check Working Memory for valid cached result ──
  const cached = workingMemory.get(toolName, normalizedArgs);
  if (cached) {
    const ageSeconds = Math.round((Date.now() - cached.timestamp) / 1000);
    console.log(`[tool-proxy] CACHE HIT: ${toolName}:${cached.inputHash} (${ageSeconds}s old)`);

    return {
      result: cached.result,
      cached: true,
      entry: cached,
      executionTime: 0,
      decision: `Reused cached ${toolName} (${Math.round(ageSeconds / 60)}m old, valid TTL)`,
      formattedHtml: cached.formattedHtml,
    };
  }

  // ── Cache miss or expired/stale → execute the handler ──
  console.log(`[tool-proxy] CACHE MISS: ${toolName}, executing handler`);

  const result = await handler(parsedArgs);
  const execTime = Date.now() - startTime;
  const summary = generateToolSummary(toolName, parsedArgs, result);
  const formattedHtml = result?.data?.formattedHtml || undefined;
  const entry = workingMemory.set(toolName, normalizedArgs, result, summary, formattedHtml);

  // Record metrics (async)
  const success = result?.success !== false;
  recordToolExecution(toolName, success, execTime).catch(err =>
    console.error("[tool-proxy] Failed to record metric:", err)
  );

  return {
    result,
    cached: false,
    entry,
    executionTime: execTime,
    decision: `Executed ${toolName} (cache miss, stored with TTL)`,
    formattedHtml,
  };
}
