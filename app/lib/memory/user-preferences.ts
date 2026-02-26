// ─── User Preferences ────────────────────────────────────────
// DynamoDB-backed store for personal facts that aren't strategies.
// Persists across sessions: name, email, home airport, aircraft type, etc.
// The agent extracts these from conversation and uses them naturally.

import { PutCommand, GetCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { dynamo } from "../aws/dynamodb";
import { TABLE_NAMES } from "./constants";

// ─── Types ───────────────────────────────────────────────────

export interface UserPreference {
  key: string;              // "name", "email", "home_airport", "aircraft_type", etc.
  value: string;            // the actual value
  source: string;           // how it was learned: "user_stated", "inferred", "tool_result"
  confidence: number;       // 0-1, how certain we are
  updatedAt: number;        // timestamp
  sessionId?: string;       // session where it was learned
}

// ─── Constants ───────────────────────────────────────────────

const TABLE_NAME = TABLE_NAMES.USER_PREFERENCES;
const USER_PK = "USER#default"; // Single-user system for now

// Known preference keys with display labels
const PREFERENCE_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  home_airport: "Home Airport",
  aircraft_type: "Aircraft Type",
  aircraft_registration: "Aircraft Registration",
  license_type: "License Type",
  preferred_units: "Preferred Units",
  preferred_altitude: "Preferred Cruise Altitude",
  preferred_fuel_reserve: "Fuel Reserve Policy",
  base_weight: "Base Aircraft Weight",
  timezone: "Timezone",
  language: "Language",
};

// Patterns to detect preference-setting statements in user messages
const EXTRACTION_PATTERNS: { pattern: RegExp; key: string; extractor: (match: RegExpMatchArray) => string }[] = [
  { pattern: /my name is (\w[\w\s]*)/i, key: "name", extractor: m => m[1].trim() },
  { pattern: /(?:i'm|i am) (\w[\w\s]*?)(?:\.|,|$)/i, key: "name", extractor: m => m[1].trim() },
  { pattern: /call me (\w[\w\s]*)/i, key: "name", extractor: m => m[1].trim() },
  { pattern: /my email(?:\s+is)?\s+([\w.+-]+@[\w.-]+)/i, key: "email", extractor: m => m[1].trim() },
  { pattern: /(?:home|base)\s+(?:airport|field|aerodrome)(?:\s+is)?\s+([A-Z]{4})/i, key: "home_airport", extractor: m => m[1].toUpperCase() },
  { pattern: /i(?:'m| am) based (?:at|in|out of) ([A-Z]{4})/i, key: "home_airport", extractor: m => m[1].toUpperCase() },
  { pattern: /(?:my|i fly(?: a)?)\s+(?:aircraft|plane|airplane)(?:\s+(?:is|type))?\s+([\w\s-]+?)(?:\.|,|$)/i, key: "aircraft_type", extractor: m => m[1].trim() },
  { pattern: /i fly (?:a )?([A-Z][\w\s-]*?\d[\w\s-]*?)(?:\.|,|$)/i, key: "aircraft_type", extractor: m => m[1].trim() },
  { pattern: /(?:registration|tail number|reg)(?:\s+(?:is|:))?\s+([A-Z0-9][\w-]{2,})/i, key: "aircraft_registration", extractor: m => m[1].toUpperCase() },
  { pattern: /(?:i have|i hold) (?:a )?(\w+)\s+(?:license|certificate|rating)/i, key: "license_type", extractor: m => m[1].trim() },
];

// ─── UserPreferencesStore Class ──────────────────────────────

export class UserPreferencesStore {
  // In-memory cache to avoid repeated DynamoDB reads
  private cache: Map<string, UserPreference> = new Map();
  private loaded = false;

  /** Load all preferences from DynamoDB into cache */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const result = await dynamo.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": USER_PK,
        },
      }));

      for (const item of result.Items || []) {
        const pref: UserPreference = {
          key: item.prefKey,
          value: item.value,
          source: item.source || "unknown",
          confidence: item.confidence ?? 1.0,
          updatedAt: item.updatedAt || Date.now(),
          sessionId: item.sessionId,
        };
        this.cache.set(pref.key, pref);
      }

      this.loaded = true;
      console.log(`[user-preferences] Loaded ${this.cache.size} preferences from DynamoDB`);
    } catch (error) {
      console.error("[user-preferences] Failed to load preferences:", error);
      this.loaded = true; // Don't retry on failure
    }
  }

  /** Get a single preference */
  async get(key: string): Promise<UserPreference | null> {
    await this.load();
    return this.cache.get(key) || null;
  }

  /** Get all preferences */
  async getAll(): Promise<UserPreference[]> {
    await this.load();
    return Array.from(this.cache.values());
  }

  /** Set a preference (persists to DynamoDB) */
  async set(
    key: string,
    value: string,
    source: string = "user_stated",
    confidence: number = 1.0,
    sessionId?: string
  ): Promise<void> {
    const pref: UserPreference = {
      key,
      value,
      source,
      confidence,
      updatedAt: Date.now(),
      sessionId,
    };

    // Update cache
    this.cache.set(key, pref);

    // Persist to DynamoDB
    try {
      await dynamo.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: USER_PK,
          SK: `PREF#${key}`,
          prefKey: key,
          value,
          source,
          confidence,
          updatedAt: pref.updatedAt,
          sessionId,
        },
      }));
      console.log(`[user-preferences] Saved preference: ${key} = "${value}" (source: ${source})`);
    } catch (error) {
      console.error(`[user-preferences] Failed to save preference ${key}:`, error);
    }
  }

  /** Delete a preference */
  async delete(key: string): Promise<void> {
    this.cache.delete(key);

    try {
      await dynamo.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: USER_PK,
          SK: `PREF#${key}`,
        },
      }));
      console.log(`[user-preferences] Deleted preference: ${key}`);
    } catch (error) {
      console.error(`[user-preferences] Failed to delete preference ${key}:`, error);
    }
  }

  /** Extract preferences from a user message (returns any newly detected preferences) */
  async extractFromMessage(message: string, sessionId?: string): Promise<UserPreference[]> {
    const extracted: UserPreference[] = [];

    for (const { pattern, key, extractor } of EXTRACTION_PATTERNS) {
      const match = message.match(pattern);
      if (match) {
        const value = extractor(match);
        if (value && value.length > 0 && value.length < 100) {
          // Check if this is actually new or different
          const existing = this.cache.get(key);
          if (!existing || existing.value.toLowerCase() !== value.toLowerCase()) {
            await this.set(key, value, "user_stated", 1.0, sessionId);
            extracted.push(this.cache.get(key)!);
          }
        }
      }
    }

    if (extracted.length > 0) {
      console.log(`[user-preferences] Extracted ${extracted.length} preferences from message: ${extracted.map(p => `${p.key}=${p.value}`).join(", ")}`);
    }

    return extracted;
  }

  /** Format preferences for injection into system prompt */
  async formatForContext(maxChars: number = 500): Promise<string> {
    await this.load();
    if (this.cache.size === 0) return "";

    let output = "═══ USER CONTEXT (remembered from past conversations) ═══\n";
    let chars = output.length;

    // Sort by confidence (highest first), then by recency
    const sorted = Array.from(this.cache.values())
      .sort((a, b) => b.confidence - a.confidence || b.updatedAt - a.updatedAt);

    for (const pref of sorted) {
      const label = PREFERENCE_LABELS[pref.key] || pref.key;
      const line = `• ${label}: ${pref.value}\n`;

      if (chars + line.length > maxChars) break;
      output += line;
      chars += line.length;
    }

    return output;
  }

  /** Get the number of stored preferences */
  get size(): number {
    return this.cache.size;
  }
}

// Singleton instance
let _store: UserPreferencesStore | null = null;

export function getUserPreferencesStore(): UserPreferencesStore {
  if (!_store) {
    _store = new UserPreferencesStore();
  }
  return _store;
}
