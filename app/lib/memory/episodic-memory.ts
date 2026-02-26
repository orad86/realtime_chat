// ─── Episodic Memory ─────────────────────────────────────────
// Structured log of what the agent DID in this session.
// Enables reasoning about prior workflows, corrections, and artifacts.

// ─── Types ───────────────────────────────────────────────────

export interface ToolAction {
  toolName: string;
  inputArgs: Record<string, any>;
  outputSummary: string;              // 1-line summary from tool-proxy
  success: boolean;
  executionTime: number;
  cached: boolean;
  decision: string;                   // rationale: "cache hit", "cache miss", etc.
  dataKeys: string[];                 // Working Memory keys produced
}

export interface Artifact {
  type: "briefing" | "nav_log" | "document" | "email" | "chart" | "weight_balance" | "other";
  toolName: string;
  url?: string;
  createdAt: number;
}

export type EpisodeOutcome = "success" | "partial" | "failed";

export interface Episode {
  id: string;
  timestamp: number;
  endTimestamp: number;
  userRequest: string;
  intent: string;                     // classified intent
  toolSequence: ToolAction[];
  outcome: EpisodeOutcome;
  artifacts: Artifact[];
  agentDecision?: string;             // rationale for the approach taken
  userFeedback?: string;              // follow-up correction or approval
  responseTime: number;               // total ms
}

// ─── Intent Classification ───────────────────────────────────

const INTENT_PATTERNS: [RegExp, string][] = [
  [/\b(brief|briefing)\b/i, "flight_briefing"],
  [/\b(weather|metar|taf|wind|forecast)\b/i, "weather_check"],
  [/\b(nav\s*log|navigation\s*log)\b/i, "nav_log"],
  [/\b(weight|balance|w&b|w\+b|loading)\b/i, "weight_balance"],
  [/\b(route|routing|flight\s*plan|waypoint|airway)\b/i, "route_planning"],
  [/\b(notam|notice)\b/i, "notam_check"],
  [/\b(runway|rwy|active)\b/i, "runway_info"],
  [/\b(airport|aerodrome)\b/i, "airport_info"],
  [/\b(chart|sigwx|prognostic)\b/i, "chart_generation"],
  [/\b(email|send|mail)\b/i, "email"],
  [/\b(schedule|remind|timer|in\s+\d+\s+min)\b/i, "scheduling"],
  [/\b(document|pdf|upload)\b/i, "document"],
  [/\b(alternate|divert)\b/i, "alternate_search"],
  [/\b(fix|correct|change|update|redo)\b/i, "correction"],
];

function classifyIntent(userRequest: string): string {
  const lower = userRequest.toLowerCase();
  for (const [pattern, intent] of INTENT_PATTERNS) {
    if (pattern.test(lower)) return intent;
  }
  return "general";
}

// ─── Artifact Detection ──────────────────────────────────────

function detectArtifacts(toolActions: ToolAction[]): Artifact[] {
  const artifacts: Artifact[] = [];
  for (const action of toolActions) {
    if (!action.success) continue;
    switch (action.toolName) {
      case "generate_flight_briefing":
        artifacts.push({ type: "briefing", toolName: action.toolName, createdAt: Date.now() });
        break;
      case "generate_nav_log":
        artifacts.push({ type: "nav_log", toolName: action.toolName, createdAt: Date.now() });
        break;
      case "calculate_weight_balance":
        artifacts.push({ type: "weight_balance", toolName: action.toolName, createdAt: Date.now() });
        break;
      case "format_weather_charts":
        artifacts.push({ type: "chart", toolName: action.toolName, createdAt: Date.now() });
        break;
      case "create_document": {
        const url = action.inputArgs?.url || undefined;
        artifacts.push({ type: "document", toolName: action.toolName, url, createdAt: Date.now() });
        break;
      }
      case "send_email":
        artifacts.push({ type: "email", toolName: action.toolName, createdAt: Date.now() });
        break;
    }
  }
  return artifacts;
}

// ─── EpisodicMemory Class ────────────────────────────────────

export class EpisodicMemory {
  private episodes: Episode[] = [];
  private maxEpisodes = 50; // Keep last 50 episodes per session

  /** Record a completed episode from a user query + tool results */
  record(
    userRequest: string,
    toolActions: ToolAction[],
    responseTime: number,
    agentDecision?: string
  ): Episode {
    const successCount = toolActions.filter(a => a.success).length;
    const failCount = toolActions.filter(a => !a.success).length;

    let outcome: EpisodeOutcome = "success";
    if (failCount > 0 && successCount === 0) outcome = "failed";
    else if (failCount > 0) outcome = "partial";

    const episode: Episode = {
      id: `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now() - responseTime,
      endTimestamp: Date.now(),
      userRequest,
      intent: classifyIntent(userRequest),
      toolSequence: toolActions,
      outcome,
      artifacts: detectArtifacts(toolActions),
      agentDecision,
      responseTime,
    };

    this.episodes.push(episode);

    // Trim if over max
    if (this.episodes.length > this.maxEpisodes) {
      this.episodes = this.episodes.slice(-this.maxEpisodes);
    }

    console.log(`[episodic-memory] Recorded episode ${episode.id}: intent=${episode.intent}, tools=${toolActions.length}, outcome=${outcome}, artifacts=${episode.artifacts.length}`);
    return episode;
  }

  /** Mark the most recent episode with user feedback (correction, approval) */
  addFeedback(feedback: string): void {
    const latest = this.latest();
    if (latest) {
      latest.userFeedback = feedback;
      console.log(`[episodic-memory] Added feedback to episode ${latest.id}: "${feedback.slice(0, 80)}..."`);
    }
  }

  /** Detect if current request is a correction/follow-up to a previous episode */
  detectCorrection(userRequest: string): Episode | null {
    const intent = classifyIntent(userRequest);
    if (intent !== "correction") return null;

    // Return the most recent episode that could be corrected
    return this.latest() || null;
  }

  /** Find episodes by intent */
  findByIntent(intent: string): Episode[] {
    return this.episodes.filter(e => e.intent === intent);
  }

  /** Find episodes that used a specific tool */
  findByTool(toolName: string): Episode[] {
    return this.episodes.filter(e =>
      e.toolSequence.some(a => a.toolName === toolName)
    );
  }

  /** Get the most recent episode */
  latest(): Episode | null {
    return this.episodes.length > 0
      ? this.episodes[this.episodes.length - 1]
      : null;
  }

  /** Get all episodes */
  getAll(): Episode[] {
    return [...this.episodes];
  }

  /** Get episode count */
  get size(): number {
    return this.episodes.length;
  }

  /** Format for injection into system prompt, sorted by recency */
  formatForContext(currentQuery: string, maxChars: number = 3000): string {
    if (this.episodes.length === 0) return "";

    const intent = classifyIntent(currentQuery);
    
    // Score episodes by relevance: same intent gets boost, corrections get boost, recency
    const scored = this.episodes.map((ep, idx) => {
      let score = idx; // base: recency (higher index = more recent)
      if (ep.intent === intent) score += 10;
      if (ep.userFeedback) score += 5; // corrections are important context
      if (ep.artifacts.length > 0) score += 3;
      return { ep, score };
    });
    scored.sort((a, b) => b.score - a.score);

    let output = "═══ SESSION HISTORY (what you've done so far) ═══\n";
    let chars = output.length;

    for (const { ep } of scored) {
      const time = new Date(ep.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      const toolNames = ep.toolSequence.map(a => {
        const icao = (a.inputArgs.icao || a.inputArgs.identifier || "").toString().toUpperCase();
        const cached = a.cached ? " [cached]" : "";
        return `${a.toolName}${icao ? `(${icao})` : ""}${cached}`;
      }).join(", ");

      const artifactStr = ep.artifacts.length > 0
        ? ` → Produced: ${ep.artifacts.map(a => a.type).join(", ")}`
        : "";

      const feedbackStr = ep.userFeedback
        ? `\n  ⚠ User feedback: "${ep.userFeedback.slice(0, 100)}"`
        : "";

      const decisionStr = ep.agentDecision
        ? `\n  Decision: ${ep.agentDecision.slice(0, 120)}`
        : "";

      const line = `[${time}] ${ep.intent} (${ep.outcome}) — Tools: ${toolNames}${artifactStr}${feedbackStr}${decisionStr}\n`;

      if (chars + line.length > maxChars) break;
      output += line;
      chars += line.length;
    }

    return output;
  }

  /** Clear all episodes */
  clear(): void {
    const count = this.episodes.length;
    this.episodes = [];
    if (count > 0) {
      console.log(`[episodic-memory] Cleared ${count} episodes`);
    }
  }
}
