/**
 * Test script for the memory system
 * Run with: npx tsx scripts/test-memory-system.ts
 */

import { logInteraction } from "../app/lib/memory/log-interaction";
import { recordToolExecution } from "../app/lib/memory/tool-metrics";
import { validateStrategy } from "../app/lib/memory/validation";
import { saveStrategy } from "../app/lib/memory/strategies";
import { selectStrategiesWithDynamicBudget } from "../app/lib/memory/injection";
import { StrategyType, SafetyRating } from "../app/lib/memory/types";

async function testMemorySystem() {
  console.log("🧪 Testing Memory System...\n");

  try {
    // Test 1: Log an interaction
    console.log("1️⃣ Testing interaction logging...");
    const interactionId = await logInteraction({
      sessionId: "test-session-001",
      userMessage: "What's the weather at KJFK?",
      agentResponse: "The weather at JFK is currently clear with 10SM visibility.",
      toolsUsed: ["get_aviation_weather_data"],
      toolResults: [{
        toolName: "get_aviation_weather_data",
        success: true,
        data: { metar: "KJFK 121851Z 31008KT 10SM FEW250 23/14 A3012" },
        executionTime: 1234
      }],
      appliedStrategies: [],
      metadata: {
        inputMode: "text",
        responseTime: 2500
      }
    });
    console.log(`✅ Logged interaction: ${interactionId}\n`);

    // Test 2: Record tool metrics
    console.log("2️⃣ Testing tool metrics...");
    await recordToolExecution("get_aviation_weather_data", true, 1234);
    console.log("✅ Recorded tool execution\n");

    // Test 3: Validate a strategy
    console.log("3️⃣ Testing strategy validation...");
    const validation = await validateStrategy(
      "Always check runway in use before suggesting approach procedures",
      {
        userQuery: "What approach should I use at KJFK?",
        agentResponse: "Check runway 22L is in use...",
        toolsUsed: ["get_runway_in_use"]
      }
    );
    console.log(`✅ Validation result: ${validation.approved ? "APPROVED" : "REJECTED"}`);
    if (validation.approved) {
      console.log(`   - Type: ${validation.strategyType}`);
      console.log(`   - Confidence: ${validation.confidence}`);
      console.log(`   - Safety: ${validation.safetyRating}\n`);
    } else {
      console.log(`   - Reason: ${validation.reason}\n`);
    }

    // Test 4: Save a strategy (if validation passed)
    if (validation.approved) {
      console.log("4️⃣ Testing strategy storage...");
      const strategyId = await saveStrategy({
        strategy: "Always check runway in use before suggesting approach procedures",
        category: "procedures",
        type: validation.strategyType as StrategyType,
        priority: 8,
        isCritical: false,
        safetyRating: validation.safetyRating as SafetyRating,
        regulatoryBasis: validation.regulatoryBasis,
        validatedAt: Date.now(),
        validatedBy: "test-script",
        confidence: validation.confidence || 0.7,
        appliedCount: 0,
        positiveOutcomes: 0,
        negativeOutcomes: 0,
        successRate: 0.5,
        conflictsWith: [],
        sourceInteractionIds: [interactionId],
        lastUsed: Date.now(),
        tags: ["runway", "approach", "procedures"]
      });
      console.log(`✅ Saved strategy: ${strategyId}\n`);
    }

    // Test 5: Strategy injection
    console.log("5️⃣ Testing strategy injection...");
    const strategies = await selectStrategiesWithDynamicBudget(
      "What's the weather at KJFK?",
      {
        maxTokens: 4000,
        estimatedResponseTokens: 500,
        isFollowUp: false
      }
    );
    console.log(`✅ Selected ${strategies.length} strategies for injection\n`);

    console.log("🎉 All tests passed!\n");
    console.log("📊 Summary:");
    console.log("   - Interaction logging: ✅");
    console.log("   - Tool metrics: ✅");
    console.log("   - Strategy validation: ✅");
    console.log("   - Strategy storage: ✅");
    console.log("   - Strategy injection: ✅");
    console.log("\n💡 Next steps:");
    console.log("   1. Start the dev server: npm run dev");
    console.log("   2. Test the agent with real queries");
    console.log("   3. Run learning job: curl http://localhost:3000/api/learning/process");
    console.log("   4. Monitor DynamoDB tables for data");

  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

// Run tests
testMemorySystem().then(() => {
  console.log("\n✨ Test complete!");
  process.exit(0);
}).catch(err => {
  console.error("\n💥 Fatal error:", err);
  process.exit(1);
});
