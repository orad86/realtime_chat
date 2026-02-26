import { createHash } from "crypto";

// ─── Types ───────────────────────────────────────────────────

export type DataKind = "raw" | "derived";

export interface ToolResultEntry {
  key: string;                          // "toolName:inputHash"
  toolName: string;
  inputArgs: Record<string, any>;
  inputHash: string;
  result: any;                          // full result object
  formattedHtml?: string;               // stripped HTML cached separately
  summary: string;                      // 1-line summary for context injection
  kind: DataKind;                       // raw data vs derived computation
  dependsOn: string[];                  // data lineage — keys/patterns this depends on
  timestamp: number;
  expiresAt: number;
  stale: boolean;                       // marked stale by dependency invalidation
}

// ─── TTL Configuration (milliseconds) ────────────────────────

const TTL_MAP: Record<string, number> = {
  // RAW data tools — expire by freshness
  get_aviation_weather_data:    30 * 60_000,    // 30 min (METAR cycle)
  get_general_weather_forecast: 2 * 3600_000,   // 2 hr
  get_notams:                   60 * 60_000,    // 1 hr
  get_airport_info:             24 * 3600_000,  // 24 hr (rarely changes)
  get_winds_aloft:              60 * 60_000,    // 1 hr
  get_aircraft_performance:     24 * 3600_000,  // 24 hr (static per aircraft)
  get_waypoint_data:            24 * 3600_000,  // 24 hr
  now:                          5 * 60_000,     // 5 min (time check)

  // DERIVED tools — no TTL, expire by dependency invalidation
  generate_nav_log:             Infinity,
  calculate_weight_balance:     Infinity,
  generate_flight_briefing:     Infinity,
  format_weather_charts:        Infinity,
  format_flight_plan:           Infinity,
  get_runway_in_use:            Infinity,
  get_procedure_in_use:         Infinity,
  detect_weather_anomalies:     Infinity,
  get_cloud_base_forecast:      Infinity,
  analyze_route:                Infinity,
  find_alternate_airports:      Infinity,
  get_traffic_flow:             Infinity,
  get_runway_queue:             Infinity,
};

// Tools that produce derived (computed) data vs raw (fetched) data
const DERIVED_TOOLS = new Set([
  "generate_nav_log",
  "calculate_weight_balance",
  "generate_flight_briefing",
  "format_weather_charts",
  "format_flight_plan",
  "get_runway_in_use",
  "get_procedure_in_use",
  "detect_weather_anomalies",
  "get_cloud_base_forecast",
  "analyze_route",
  "find_alternate_airports",
  "get_traffic_flow",
  "get_runway_queue",
]);

// Dependency graph: derived tool → function that resolves which raw keys it depends on
const DEPENDENCY_RULES: Record<string, (args: Record<string, any>) => string[]> = {
  generate_nav_log: (args) => {
    const deps: string[] = [];
    if (args.winds) deps.push("get_winds_aloft:*");
    for (const wp of args.waypoints || []) {
      if (wp.identifier) deps.push(`get_airport_info:${wp.identifier.toUpperCase()}`);
    }
    return deps;
  },
  get_runway_in_use: (args) => {
    const icao = extractIcao(args);
    return icao
      ? [`get_airport_info:${icao}`, `get_aviation_weather_data:${icao}`]
      : [];
  },
  get_procedure_in_use: (args) => {
    const icao = extractIcao(args);
    return icao
      ? [`get_airport_info:${icao}`, `get_runway_in_use:${icao}`]
      : [];
  },
  detect_weather_anomalies: (args) => {
    const icao = extractIcao(args);
    return icao ? [`get_aviation_weather_data:${icao}`] : [];
  },
  get_cloud_base_forecast: () => ["get_general_weather_forecast:*"],
  format_weather_charts: (args) => {
    const icao = extractIcao(args);
    return icao ? [`get_aviation_weather_data:${icao}`] : [];
  },
  find_alternate_airports: (args) => {
    const icao = extractIcao(args);
    return icao ? [`get_airport_info:${icao}`] : [];
  },
  get_traffic_flow: (args) => {
    const icao = extractIcao(args);
    return icao ? [`get_airport_info:${icao}`] : [];
  },
  get_runway_queue: (args) => {
    const icao = extractIcao(args);
    return icao ? [`get_airport_info:${icao}`] : [];
  },
  calculate_weight_balance: () => ["get_aircraft_performance:*"],
  generate_flight_briefing: () => ["*"], // depends on everything
};

// ─── Helper ──────────────────────────────────────────────────

function extractIcao(args: Record<string, any>): string {
  const raw = args.icao || args.identifier || args.station || "";
  return typeof raw === "string" ? raw.toUpperCase().trim() : "";
}

// ─── WorkingMemory Class ─────────────────────────────────────

export class WorkingMemory {
  private store = new Map<string, ToolResultEntry>();

  /** Deterministic hash of tool args for cache key */
  static hashArgs(args: Record<string, any>): string {
    // Sort keys for deterministic serialization
    const sorted = JSON.stringify(args, Object.keys(args).sort());
    return createHash("sha256").update(sorted).digest("hex").slice(0, 12);
  }

  /** Build the full cache key */
  static buildKey(toolName: string, args: Record<string, any>): string {
    return `${toolName}:${WorkingMemory.hashArgs(args)}`;
  }

  /** Normalize tool args for consistent cache keys (uppercase ICAO, trim) */
  static normalizeArgs(toolName: string, args: Record<string, any>): Record<string, any> {
    const normalized = { ...args };
    if (normalized.icao) normalized.icao = String(normalized.icao).toUpperCase().trim();
    if (normalized.identifier) normalized.identifier = String(normalized.identifier).toUpperCase().trim();
    if (normalized.station) normalized.station = String(normalized.station).toUpperCase().trim();
    return normalized;
  }

  /** Check if a valid (non-expired, non-stale) cache entry exists */
  get(toolName: string, args: Record<string, any>): ToolResultEntry | null {
    const normalized = WorkingMemory.normalizeArgs(toolName, args);
    const key = WorkingMemory.buildKey(toolName, normalized);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.stale) {
      console.log(`[working-memory] Entry ${key} is stale (dependency changed)`);
      return null;
    }
    if (entry.expiresAt !== Infinity && Date.now() > entry.expiresAt) {
      console.log(`[working-memory] Entry ${key} expired (TTL)`);
      this.invalidateKey(key);
      return null;
    }
    return entry;
  }

  /** Store a tool result with lineage tracking and TTL */
  set(
    toolName: string,
    args: Record<string, any>,
    result: any,
    summary: string,
    formattedHtml?: string
  ): ToolResultEntry {
    const normalized = WorkingMemory.normalizeArgs(toolName, args);
    const inputHash = WorkingMemory.hashArgs(normalized);
    const key = `${toolName}:${inputHash}`;
    const kind: DataKind = DERIVED_TOOLS.has(toolName) ? "derived" : "raw";
    const ttl = TTL_MAP[toolName] ?? 30 * 60_000; // default 30 min

    // Resolve dependency keys
    const depResolver = DEPENDENCY_RULES[toolName];
    const dependsOn = depResolver ? depResolver(normalized) : [];

    const entry: ToolResultEntry = {
      key,
      toolName,
      inputArgs: normalized,
      inputHash,
      result,
      formattedHtml,
      summary,
      kind,
      dependsOn,
      timestamp: Date.now(),
      expiresAt: ttl === Infinity ? Infinity : Date.now() + ttl,
      stale: false,
    };

    this.store.set(key, entry);
    console.log(`[working-memory] Stored ${key} (${kind}, deps=[${dependsOn.join(",")}], TTL=${ttl === Infinity ? "session" : Math.round(ttl / 60_000) + "m"})`);

    // If a RAW entry is being refreshed, cascade-invalidate derived entries that depend on it
    if (kind === "raw") {
      this.cascadeInvalidate(key);
    }

    return entry;
  }

  /** Get all valid entries for a given tool name */
  getByTool(toolName: string): ToolResultEntry[] {
    const results: ToolResultEntry[] = [];
    for (const entry of this.store.values()) {
      if (entry.toolName === toolName && !entry.stale && this.isValid(entry)) {
        results.push(entry);
      }
    }
    return results;
  }

  /** Get all valid (non-expired, non-stale) entries */
  getAll(): ToolResultEntry[] {
    const results: ToolResultEntry[] = [];
    for (const entry of this.store.values()) {
      if (!entry.stale && this.isValid(entry)) {
        results.push(entry);
      }
    }
    return results;
  }

  /** Find entries by ICAO code across all tools */
  getByIcao(icao: string): ToolResultEntry[] {
    const upper = icao.toUpperCase().trim();
    const results: ToolResultEntry[] = [];
    for (const entry of this.store.values()) {
      if (!entry.stale && this.isValid(entry)) {
        const entryIcao = extractIcao(entry.inputArgs);
        if (entryIcao === upper) results.push(entry);
      }
    }
    return results;
  }

  /** Prune expired + stale entries. Returns count of pruned. */
  prune(): number {
    let pruned = 0;
    for (const [key, entry] of this.store) {
      if (entry.stale || !this.isValid(entry)) {
        this.store.delete(key);
        pruned++;
      }
    }
    if (pruned > 0) {
      console.log(`[working-memory] Pruned ${pruned} expired/stale entries (${this.store.size} remaining)`);
    }
    return pruned;
  }

  /** Format working memory for injection into system prompt, sorted by relevance */
  formatForContext(currentQuery: string, maxChars: number = 3000): string {
    const entries = this.getAll();
    if (entries.length === 0) return "";

    // Score by relevance to current query + freshness
    const scored = entries.map(e => ({
      entry: e,
      score: this.relevanceScore(e, currentQuery),
    }));
    scored.sort((a, b) => b.score - a.score);

    let output = "═══ WORKING MEMORY (cached data — DO NOT re-fetch unless user asks to refresh) ═══\n";
    let chars = output.length;

    for (const { entry } of scored) {
      const ageMin = Math.round((Date.now() - entry.timestamp) / 60_000);
      const ttlRemain = entry.expiresAt === Infinity
        ? "session"
        : `${Math.max(0, Math.round((entry.expiresAt - Date.now()) / 60_000))}m left`;
      const kindTag = entry.kind === "derived" ? " [computed]" : "";
      const line = `• ${entry.toolName}(${this.summarizeArgs(entry.inputArgs)}): ${entry.summary} [${ageMin}m ago, ${ttlRemain}${kindTag}]\n`;

      if (chars + line.length > maxChars) break;
      output += line;
      chars += line.length;
    }

    return output;
  }

  /** Reset all memory */
  clear(): void {
    const size = this.store.size;
    this.store.clear();
    if (size > 0) {
      console.log(`[working-memory] Cleared ${size} entries`);
    }
  }

  get size(): number {
    return this.store.size;
  }

  // ─── Private helpers ─────────────────────────────────────

  private isValid(entry: ToolResultEntry): boolean {
    if (entry.expiresAt === Infinity) return true;
    return Date.now() <= entry.expiresAt;
  }

  /** Invalidate a specific key and cascade to its dependents */
  private invalidateKey(key: string): void {
    this.store.delete(key);
    this.cascadeInvalidate(key);
  }

  /** Mark derived entries as stale if they depend on a changed raw key */
  private cascadeInvalidate(changedKey: string): void {
    const toolPrefix = changedKey.split(":")[0];
    for (const entry of this.store.values()) {
      if (entry.kind !== "derived" || entry.stale) continue;
      for (const dep of entry.dependsOn) {
        // Match exact key, wildcard (tool:*), or global wildcard (*)
        if (dep === "*" || dep === changedKey || dep === `${toolPrefix}:*`) {
          entry.stale = true;
          console.log(`[working-memory] Staled ${entry.key} (dependency ${dep} ← ${changedKey} changed)`);
          break;
        }
        // Partial match: dep might be "get_airport_info:LLBG" and changedKey "get_airport_info:abc123hash"
        // We need to also match by ICAO in the changed entry
        if (dep.includes(":") && !dep.endsWith("*")) {
          const [depTool, depIcao] = dep.split(":");
          if (depTool === toolPrefix) {
            const changedEntry = this.store.get(changedKey);
            if (changedEntry) {
              const changedIcao = extractIcao(changedEntry.inputArgs);
              if (changedIcao === depIcao) {
                entry.stale = true;
                console.log(`[working-memory] Staled ${entry.key} (ICAO dependency ${depIcao} changed)`);
                break;
              }
            }
          }
        }
      }
    }
  }

  /** Score entry relevance to current query */
  private relevanceScore(entry: ToolResultEntry, query: string): number {
    let score = 0;
    const q = query.toLowerCase();
    const tool = entry.toolName.toLowerCase();
    const argStr = JSON.stringify(entry.inputArgs).toLowerCase();

    // Tool name relevance — match query keywords to tool domains
    const domainMatches: [string, string][] = [
      ["weather", "weather"], ["metar", "weather"], ["taf", "weather"],
      ["briefing", "briefing"], ["brief", "briefing"],
      ["nav", "nav"], ["route", "route"], ["navigation", "nav"],
      ["chart", "chart"], ["weight", "weight"], ["balance", "weight"],
      ["runway", "runway"], ["notam", "notam"], ["airport", "airport"],
      ["wind", "wind"], ["alternate", "alternate"],
    ];
    for (const [keyword, toolFragment] of domainMatches) {
      if (q.includes(keyword) && tool.includes(toolFragment)) {
        score += 3;
      }
    }

    // ICAO codes mentioned in query matching entry args
    const icaoMatches = q.match(/\b[A-Za-z]{4}\b/g);
    if (icaoMatches) {
      for (const icao of icaoMatches) {
        if (argStr.includes(icao.toLowerCase())) score += 5;
      }
    }

    // Freshness bonus (newer = higher score, up to 2 points for <30min old)
    const ageMin = (Date.now() - entry.timestamp) / 60_000;
    score += Math.max(0, 2 - ageMin / 30);

    // Derived data gets slight boost (more expensive to recompute)
    if (entry.kind === "derived") score += 1;

    return score;
  }

  /** Short summary of tool args for context injection */
  private summarizeArgs(args: Record<string, any>): string {
    const icao = extractIcao(args);
    if (icao) return icao;
    // For tools without ICAO, show first meaningful param
    const keys = Object.keys(args);
    if (keys.length === 0) return "…";
    const first = args[keys[0]];
    if (typeof first === "string" && first.length < 20) return first;
    return keys.slice(0, 2).join(",");
  }
}
