# Long-Term Memory System Implementation Guide

## Overview

This document provides a comprehensive guide to the AWS-based long-term memory system implemented for the aviation agent. This system enables the agent to learn from interactions, improve over time, and accumulate domain expertise without retraining the base model.

## Architecture Summary

The memory system consists of several key components:

1. **Interaction Logging** - Captures every user interaction
2. **Strategy Storage** - Stores learned patterns and rules
3. **Tool Metrics** - Tracks tool performance and reliability
4. **Validation Engine** - Ensures strategy quality and safety
5. **Confidence Engine** - Updates strategy effectiveness over time
6. **Conflict Detection** - Prevents contradictory strategies
7. **Strategy Injection** - Selects and injects relevant strategies at runtime

## Installation

### 1. Install AWS SDK Dependencies

```bash
npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your AWS credentials:

```bash
cp .env.example .env
```

Required variables:
- `AWS_REGION` - AWS region (e.g., us-east-1)
- `AWS_ACCESS_KEY_ID` - Your AWS access key
- `AWS_SECRET_ACCESS_KEY` - Your AWS secret key
- `OPENAI_API_KEY` - Your OpenAI API key

### 3. Create DynamoDB Tables

Use the AWS CLI or Console to create the following tables:

#### AgentInteractions Table
```bash
aws dynamodb create-table \
  --table-name AgentInteractions \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S \
    AttributeName=GSI1SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
    '[{
      "IndexName": "ProcessingIndex",
      "KeySchema": [
        {"AttributeName": "GSI1PK", "KeyType": "HASH"},
        {"AttributeName": "GSI1SK", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"}
    }]' \
  --billing-mode PAY_PER_REQUEST \
  --time-to-live-specification Enabled=true,AttributeName=ttl
```

#### AgentStrategies Table
```bash
aws dynamodb create-table \
  --table-name AgentStrategies \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S \
    AttributeName=GSI1SK,AttributeType=S \
    AttributeName=GSI2PK,AttributeType=S \
    AttributeName=GSI2SK,AttributeType=S \
    AttributeName=GSI3PK,AttributeType=S \
    AttributeName=GSI3SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
    '[{
      "IndexName": "CategoryPriorityIndex",
      "KeySchema": [
        {"AttributeName": "GSI1PK", "KeyType": "HASH"},
        {"AttributeName": "GSI1SK", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"}
    },
    {
      "IndexName": "TypeConfidenceIndex",
      "KeySchema": [
        {"AttributeName": "GSI2PK", "KeyType": "HASH"},
        {"AttributeName": "GSI2SK", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"}
    },
    {
      "IndexName": "QualityIndex",
      "KeySchema": [
        {"AttributeName": "GSI3PK", "KeyType": "HASH"},
        {"AttributeName": "GSI3SK", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"}
    }]' \
  --billing-mode PAY_PER_REQUEST
```

#### ToolMetrics Table
```bash
aws dynamodb create-table \
  --table-name ToolMetrics \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S \
    AttributeName=GSI1SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
    '[{
      "IndexName": "ReliabilityIndex",
      "KeySchema": [
        {"AttributeName": "GSI1PK", "KeyType": "HASH"},
        {"AttributeName": "GSI1SK", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"}
    }]' \
  --billing-mode PAY_PER_REQUEST
```

#### StrategyConflicts Table
```bash
aws dynamodb create-table \
  --table-name StrategyConflicts \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S \
    AttributeName=GSI1SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
    '[{
      "IndexName": "ResolutionIndex",
      "KeySchema": [
        {"AttributeName": "GSI1PK", "KeyType": "HASH"},
        {"AttributeName": "GSI1SK", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"}
    }]' \
  --billing-mode PAY_PER_REQUEST \
  --time-to-live-specification Enabled=true,AttributeName=ttl
```

#### KnowledgeGaps Table
```bash
aws dynamodb create-table \
  --table-name KnowledgeGaps \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S \
    AttributeName=GSI1SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
    '[{
      "IndexName": "PriorityIndex",
      "KeySchema": [
        {"AttributeName": "GSI1PK", "KeyType": "HASH"},
        {"AttributeName": "GSI1SK", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"}
    }]' \
  --billing-mode PAY_PER_REQUEST \
  --time-to-live-specification Enabled=true,AttributeName=ttl
```

## File Structure

```
app/lib/
├── aws/
│   └── dynamodb.ts              # DynamoDB client configuration
└── memory/
    ├── types.ts                 # TypeScript type definitions
    ├── constants.ts             # Configuration constants
    ├── validation.ts            # Strategy validation engine
    ├── log-interaction.ts       # Interaction logging
    ├── tool-metrics.ts          # Tool performance tracking
    ├── strategies.ts            # Strategy storage and retrieval
    ├── confidence.ts            # Confidence update engine
    ├── conflicts.ts             # Conflict detection
    └── injection.ts             # Strategy injection orchestrator
```

## Usage

### 1. Logging Interactions

```typescript
import { logInteraction } from "@/lib/memory/log-interaction";

await logInteraction({
  sessionId: "session-123",
  userMessage: "What's the weather at JFK?",
  agentResponse: "The weather at JFK is...",
  toolsUsed: ["get_aviation_weather_data"],
  toolResults: [{
    toolName: "get_aviation_weather_data",
    success: true,
    data: {...},
    executionTime: 1234
  }],
  appliedStrategies: ["strategy-id-1", "strategy-id-2"],
  metadata: {
    inputMode: "text",
    responseTime: 2500
  }
});
```

### 2. Recording Tool Metrics

```typescript
import { recordToolExecution } from "@/lib/memory/tool-metrics";

await recordToolExecution(
  "get_aviation_weather_data",
  true, // success
  1234, // response time in ms
  undefined, // error (if any)
  "weather query" // context
);
```

### 3. Validating and Saving Strategies

```typescript
import { validateStrategy } from "@/lib/memory/validation";
import { saveStrategy } from "@/lib/memory/strategies";

// Validate strategy
const validation = await validateStrategy(
  "Always check runway in use before suggesting approach",
  {
    userQuery: "What approach should I use?",
    agentResponse: "Check runway 27 is in use...",
    toolsUsed: ["get_runway_in_use"]
  }
);

if (validation.approved) {
  // Save strategy
  const strategyId = await saveStrategy({
    strategy: "Always check runway in use before suggesting approach",
    category: "procedures",
    type: validation.strategyType!,
    priority: 8,
    isCritical: false,
    safetyRating: validation.safetyRating!,
    regulatoryBasis: validation.regulatoryBasis,
    validatedAt: Date.now(),
    validatedBy: "gpt-4o",
    confidence: validation.confidence!,
    appliedCount: 0,
    positiveOutcomes: 0,
    negativeOutcomes: 0,
    successRate: 0.5,
    conflictsWith: [],
    sourceInteractionIds: ["interaction-123"],
    lastUsed: Date.now(),
    tags: ["runway", "approach", "procedures"]
  });
}
```

### 4. Injecting Strategies at Runtime

```typescript
import { selectStrategiesWithDynamicBudget, formatStrategiesForPrompt } from "@/lib/memory/injection";

// Select relevant strategies
const strategies = await selectStrategiesWithDynamicBudget(
  "What's the weather at JFK?",
  {
    maxTokens: 4000,
    estimatedResponseTokens: 500,
    isFollowUp: false
  }
);

// Format for prompt injection
const strategiesText = formatStrategiesForPrompt(strategies);

// Inject into system prompt
const enhancedPrompt = `
${originalSystemPrompt}

LEARNED OPERATIONAL STRATEGIES:
${strategiesText}

Apply these strategies when relevant to the current query.
`;
```

### 5. Updating Confidence

```typescript
import { updateConfidenceWithMomentum } from "@/lib/memory/confidence";
import { OutcomeType } from "@/lib/memory/types";

await updateConfidenceWithMomentum(
  "strategy-id-123",
  {
    strategyId: "strategy-id-123",
    interactionId: "interaction-456",
    signalType: OutcomeType.USER_ACCEPTED,
    weight: 0.05,
    timestamp: Date.now()
  }
);
```

## Integration with Existing Agent

To integrate the memory system with your existing agent in `/app/lib/langchain/agent.ts`:

```typescript
import { selectStrategiesWithDynamicBudget, formatStrategiesForPrompt, getStrategyIds } from "@/lib/memory/injection";
import { logInteraction } from "@/lib/memory/log-interaction";
import { recordToolExecution } from "@/lib/memory/tool-metrics";

export async function handleAviationQuery(
  history: OpenAI.Chat.ChatCompletionMessageParam[],
  sessionId: string
) {
  // 1. Load relevant strategies
  const userQuery = history[history.length - 1].content as string;
  const strategies = await selectStrategiesWithDynamicBudget(userQuery, {
    maxTokens: 4000,
    estimatedResponseTokens: 500,
    isFollowUp: history.length > 1
  });
  
  const strategyIds = getStrategyIds(strategies);
  const strategiesText = formatStrategiesForPrompt(strategies);
  
  // 2. Enhance system prompt
  const enhancedPrompt = `
${SYSTEM_PROMPT}

LEARNED OPERATIONAL STRATEGIES:
${strategiesText}

Apply these strategies when relevant to the current query.
`;
  
  // 3. Process query with enhanced context
  const messages = [
    { role: "system", content: enhancedPrompt },
    ...history
  ];
  
  // ... rest of your agent logic ...
  
  // 4. Log interaction (async, don't block response)
  logInteraction({
    sessionId,
    userMessage: userQuery,
    agentResponse: finalResponse,
    toolsUsed: toolNames,
    toolResults: toolResults,
    appliedStrategies: strategyIds,
    metadata: {
      inputMode: "text",
      responseTime: Date.now() - startTime
    }
  }).catch(err => console.error("Failed to log interaction:", err));
  
  // 5. Record tool metrics (async)
  for (const result of toolResults) {
    recordToolExecution(
      result.toolName,
      result.success,
      result.executionTime,
      result.error
    ).catch(err => console.error("Failed to record tool metric:", err));
  }
  
  return finalResponse;
}
```

## Background Learning Job

Create an API route at `/app/api/learning/process/route.ts`:

```typescript
import { getUnprocessedInteractions, markInteractionProcessed } from "@/lib/memory/log-interaction";
import { validateStrategy } from "@/lib/memory/validation";
import { saveStrategy } from "@/lib/memory/strategies";
import { detectConflicts } from "@/lib/memory/conflicts";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function GET() {
  const interactions = await getUnprocessedInteractions(50);
  
  let processed = 0;
  let strategiesCreated = 0;
  
  for (const interaction of interactions) {
    try {
      // Analyze interaction with GPT
      const analysis = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{
          role: "system",
          content: `
Analyze this aviation agent interaction to extract learnings.

USER QUERY: ${interaction.userMessage}
AGENT RESPONSE: ${interaction.agentResponse}
TOOLS USED: ${interaction.toolsUsed.join(", ")}
TOOL RESULTS: ${JSON.stringify(interaction.toolResults)}

Extract ONLY meaningful patterns:
1. Reusable strategies (aviation-specific patterns)
2. Safety rules (critical aviation safety patterns)
3. Tool optimization (better tool usage patterns)
4. Error handling (failure recovery patterns)

Return JSON:
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

If nothing meaningful, return empty array.
`
        }],
        response_format: { type: "json_object" }
      });
      
      const result = JSON.parse(analysis.choices[0].message.content || "{}");
      
      // Validate and save each strategy
      for (const strategyData of result.strategies || []) {
        const validation = await validateStrategy(strategyData.text, {
          userQuery: interaction.userMessage,
          agentResponse: interaction.agentResponse,
          toolsUsed: interaction.toolsUsed
        });
        
        if (validation.approved) {
          // Check for conflicts
          const conflicts = await detectConflicts(strategyData.text, strategyData.category);
          
          if (conflicts.length === 0) {
            await saveStrategy({
              strategy: strategyData.text,
              category: strategyData.category,
              type: validation.strategyType!,
              priority: validation.strategyType === "safety_critical" ? 10 : 5,
              isCritical: validation.strategyType === "safety_critical",
              safetyRating: validation.safetyRating!,
              regulatoryBasis: validation.regulatoryBasis,
              validatedAt: Date.now(),
              validatedBy: "gpt-4o",
              confidence: validation.confidence!,
              appliedCount: 0,
              positiveOutcomes: 0,
              negativeOutcomes: 0,
              successRate: 0.5,
              conflictsWith: [],
              sourceInteractionIds: [interaction.id],
              lastUsed: Date.now(),
              tags: strategyData.tags
            });
            
            strategiesCreated++;
          }
        }
      }
      
      // Mark as processed
      await markInteractionProcessed(interaction.id, interaction.sessionId, interaction.timestamp);
      processed++;
      
    } catch (error) {
      console.error(`Failed to process interaction ${interaction.id}:`, error);
    }
  }
  
  return Response.json({ 
    processed,
    strategiesCreated,
    status: "completed" 
  });
}
```

## Expected Behavior Timeline

- **Week 1:** Agent stops making known mistakes
- **Week 2:** Tool selection becomes noticeably smarter
- **Week 4:** Consistent reasoning patterns emerge
- **Week 8:** Agent identifies its own knowledge gaps
- **Week 12:** Agent behaves like a trained aviation specialist

## Cost Estimates

For 1000 interactions/day:
- DynamoDB: ~$18-20/month
- OpenAI (validation + learning): ~$10-15/month
- **Total: ~$30-35/month**

## Monitoring

Key metrics to monitor:
- Strategy count by type
- Average confidence scores
- Tool reliability scores
- Conflict detection rate
- Learning job success rate

## Next Steps

1. Install AWS SDK dependencies
2. Configure environment variables
3. Create DynamoDB tables
4. Integrate memory system into agent
5. Deploy background learning job
6. Monitor and iterate

## Support

For issues or questions, refer to the implementation files in `/app/lib/memory/`.
