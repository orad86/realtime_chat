import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getUnprocessedInteractions, markInteractionProcessed } from "@/app/lib/memory/log-interaction";
import { validateStrategy } from "@/app/lib/memory/validation";
import { saveStrategy } from "@/app/lib/memory/strategies";
import { detectConflicts, saveConflict } from "@/app/lib/memory/conflicts";
import { StrategyType, SafetyRating, ConflictSeverity, ResolutionAction } from "@/app/lib/memory/types";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Analysis prompt for extracting strategies from interactions
const ANALYSIS_PROMPT = `
You are analyzing an aviation agent interaction to extract learnings.

Extract ONLY meaningful patterns:
1. **Reusable strategies** (aviation-specific patterns)
   - Format: "When [condition], always [action]"
   - Example: "When weather API returns 400, check if dates are historical"

2. **Safety rules** (critical aviation safety patterns)
   - Format: "Never [action] because [reason]"
   - Example: "Never suggest VFR flight when visibility < 3SM"

3. **Tool optimization** (better tool usage patterns)
   - Format: "Use [tool] instead of [tool] when [condition]"
   - Example: "Use get_aviation_weather_data instead of get_general_weather_forecast for airport-specific weather"

4. **Error handling** (failure recovery patterns)
   - Format: "If [tool] fails with [error], try [alternative]"
   - Example: "If Jeppesen RAG fails, fall back to get_airport_procedures"

5. **User experience** (communication improvements)
   - Format: "When explaining [topic], include [detail]"
   - Example: "When explaining METAR, always decode visibility and ceiling"

Return as JSON:
{
  "strategies": [
    {
      "text": "strategy description",
      "category": "weather|routing|safety|tools|communication",
      "confidence": 0.0-1.0,
      "tags": ["tag1", "tag2"]
    }
  ]
}

If nothing meaningful to extract, return empty array.
`;

export async function GET() {
  try {
    console.log("[Learning] Starting batch learning process...");
    
    // Get unprocessed interactions
    const interactions = await getUnprocessedInteractions(50);
    
    if (interactions.length === 0) {
      return NextResponse.json({
        status: "no_work",
        message: "No unprocessed interactions found",
        processed: 0,
        strategiesCreated: 0
      });
    }
    
    console.log(`[Learning] Processing ${interactions.length} interactions`);
    
    let processed = 0;
    let strategiesCreated = 0;
    let strategiesRejected = 0;
    const errors: string[] = [];
    
    for (const interaction of interactions) {
      try {
        // Analyze interaction with GPT
        const analysis = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{
            role: "system",
            content: `${ANALYSIS_PROMPT}

USER QUERY: ${interaction.userMessage}
AGENT RESPONSE: ${interaction.agentResponse}
TOOLS USED: ${interaction.toolsUsed.join(", ")}
TOOL RESULTS: ${JSON.stringify(interaction.toolResults)}
`
          }],
          response_format: { type: "json_object" },
          temperature: 0.3
        });
        
        const result = JSON.parse(analysis.choices[0].message.content || "{}");
        
        // Validate and save each strategy
        for (const strategyData of result.strategies || []) {
          try {
            // Validate strategy
            const validation = await validateStrategy(strategyData.text, {
              userQuery: interaction.userMessage,
              agentResponse: interaction.agentResponse,
              toolsUsed: interaction.toolsUsed
            });
            
            if (!validation.approved) {
              console.log(`[Learning] Strategy rejected: ${validation.reason}`);
              strategiesRejected++;
              continue;
            }
            
            // Check for conflicts
            const conflicts = await detectConflicts(strategyData.text, strategyData.category);
            
            if (conflicts.length > 0) {
              console.log(`[Learning] Strategy has ${conflicts.length} conflicts, skipping`);
              
              // Save conflict records
              for (const conflict of conflicts) {
                await saveConflict(
                  "pending", // New strategy ID (not saved yet)
                  conflict.existingStrategyId,
                  conflict.conflictType,
                  conflict.severity,
                  ResolutionAction.REJECT_NEW,
                  conflict.explanation
                );
              }
              
              strategiesRejected++;
              continue;
            }
            
            // Determine priority based on type
            const typeRules: Record<string, number> = {
              safety_critical: 10,
              regulatory: 9,
              tool_optimization: 6,
              reasoning_heuristic: 5,
              communication: 3,
              experimental: 1
            };
            
            const priority = typeRules[validation.strategyType || "experimental"] || 5;
            
            // Save strategy
            await saveStrategy({
              strategy: strategyData.text,
              category: strategyData.category,
              type: validation.strategyType as StrategyType || StrategyType.EXPERIMENTAL,
              priority,
              isCritical: validation.strategyType === "safety_critical",
              safetyRating: validation.safetyRating || SafetyRating.SAFE,
              regulatoryBasis: validation.regulatoryBasis,
              validatedAt: Date.now(),
              validatedBy: "gpt-4o",
              confidence: validation.confidence || 0.5,
              appliedCount: 0,
              positiveOutcomes: 0,
              negativeOutcomes: 0,
              successRate: 0.5,
              conflictsWith: [],
              sourceInteractionIds: [interaction.id],
              lastUsed: Date.now(),
              tags: strategyData.tags || []
            });
            
            strategiesCreated++;
            console.log(`[Learning] Created strategy: ${strategyData.text.substring(0, 50)}...`);
            
          } catch (strategyError) {
            console.error(`[Learning] Failed to process strategy:`, strategyError);
            errors.push(`Strategy processing error: ${strategyError instanceof Error ? strategyError.message : String(strategyError)}`);
          }
        }
        
        // Mark interaction as processed
        await markInteractionProcessed(interaction.id, interaction.sessionId, interaction.timestamp);
        processed++;
        
      } catch (interactionError) {
        console.error(`[Learning] Failed to process interaction ${interaction.id}:`, interactionError);
        errors.push(`Interaction ${interaction.id}: ${interactionError instanceof Error ? interactionError.message : String(interactionError)}`);
      }
    }
    
    console.log(`[Learning] Batch complete: ${processed} processed, ${strategiesCreated} strategies created, ${strategiesRejected} rejected`);
    
    return NextResponse.json({
      status: "completed",
      processed,
      strategiesCreated,
      strategiesRejected,
      errors: errors.length > 0 ? errors : undefined
    });
    
  } catch (error) {
    console.error("[Learning] Batch learning failed:", error);
    return NextResponse.json(
      {
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
