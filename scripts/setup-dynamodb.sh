#!/bin/bash

# Setup DynamoDB tables for the memory system
# Run this script to create all required tables

set -e

echo "🚀 Setting up DynamoDB tables for memory system..."

# Get AWS region from environment or use default
REGION=${AWS_REGION:-us-east-1}

echo "📍 Using AWS region: $REGION"

# 1. AgentInteractions Table
echo "📊 Creating AgentInteractions table..."
aws dynamodb create-table \
  --region $REGION \
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
    "[{
      \"IndexName\": \"ProcessingIndex\",
      \"KeySchema\": [
        {\"AttributeName\": \"GSI1PK\", \"KeyType\": \"HASH\"},
        {\"AttributeName\": \"GSI1SK\", \"KeyType\": \"RANGE\"}
      ],
      \"Projection\": {\"ProjectionType\": \"ALL\"}
    }]" \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=RealtimeChat Key=Component,Value=Memory || echo "⚠️  AgentInteractions table may already exist"

# Enable TTL
echo "⏰ Enabling TTL for AgentInteractions..."
aws dynamodb update-time-to-live \
  --region $REGION \
  --table-name AgentInteractions \
  --time-to-live-specification Enabled=true,AttributeName=ttl || echo "⚠️  TTL may already be enabled"

# 2. AgentStrategies Table
echo "📊 Creating AgentStrategies table..."
aws dynamodb create-table \
  --region $REGION \
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
    "[{
      \"IndexName\": \"CategoryPriorityIndex\",
      \"KeySchema\": [
        {\"AttributeName\": \"GSI1PK\", \"KeyType\": \"HASH\"},
        {\"AttributeName\": \"GSI1SK\", \"KeyType\": \"RANGE\"}
      ],
      \"Projection\": {\"ProjectionType\": \"ALL\"}
    },
    {
      \"IndexName\": \"TypeConfidenceIndex\",
      \"KeySchema\": [
        {\"AttributeName\": \"GSI2PK\", \"KeyType\": \"HASH\"},
        {\"AttributeName\": \"GSI2SK\", \"KeyType\": \"RANGE\"}
      ],
      \"Projection\": {\"ProjectionType\": \"ALL\"}
    },
    {
      \"IndexName\": \"QualityIndex\",
      \"KeySchema\": [
        {\"AttributeName\": \"GSI3PK\", \"KeyType\": \"HASH\"},
        {\"AttributeName\": \"GSI3SK\", \"KeyType\": \"RANGE\"}
      ],
      \"Projection\": {\"ProjectionType\": \"ALL\"}
    }]" \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=RealtimeChat Key=Component,Value=Memory || echo "⚠️  AgentStrategies table may already exist"

# 3. ToolMetrics Table
echo "📊 Creating ToolMetrics table..."
aws dynamodb create-table \
  --region $REGION \
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
    "[{
      \"IndexName\": \"ReliabilityIndex\",
      \"KeySchema\": [
        {\"AttributeName\": \"GSI1PK\", \"KeyType\": \"HASH\"},
        {\"AttributeName\": \"GSI1SK\", \"KeyType\": \"RANGE\"}
      ],
      \"Projection\": {\"ProjectionType\": \"ALL\"}
    }]" \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=RealtimeChat Key=Component,Value=Memory || echo "⚠️  ToolMetrics table may already exist"

# 4. StrategyConflicts Table
echo "📊 Creating StrategyConflicts table..."
aws dynamodb create-table \
  --region $REGION \
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
    "[{
      \"IndexName\": \"ResolutionIndex\",
      \"KeySchema\": [
        {\"AttributeName\": \"GSI1PK\", \"KeyType\": \"HASH\"},
        {\"AttributeName\": \"GSI1SK\", \"KeyType\": \"RANGE\"}
      ],
      \"Projection\": {\"ProjectionType\": \"ALL\"}
    }]" \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=RealtimeChat Key=Component,Value=Memory || echo "⚠️  StrategyConflicts table may already exist"

# Enable TTL
echo "⏰ Enabling TTL for StrategyConflicts..."
aws dynamodb update-time-to-live \
  --region $REGION \
  --table-name StrategyConflicts \
  --time-to-live-specification Enabled=true,AttributeName=ttl || echo "⚠️  TTL may already be enabled"

# 5. KnowledgeGaps Table
echo "📊 Creating KnowledgeGaps table..."
aws dynamodb create-table \
  --region $REGION \
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
    "[{
      \"IndexName\": \"PriorityIndex\",
      \"KeySchema\": [
        {\"AttributeName\": \"GSI1PK\", \"KeyType\": \"HASH\"},
        {\"AttributeName\": \"GSI1SK\", \"KeyType\": \"RANGE\"}
      ],
      \"Projection\": {\"ProjectionType\": \"ALL\"}
    }]" \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=RealtimeChat Key=Component,Value=Memory || echo "⚠️  KnowledgeGaps table may already exist"

# Enable TTL
echo "⏰ Enabling TTL for KnowledgeGaps..."
aws dynamodb update-time-to-live \
  --region $REGION \
  --table-name KnowledgeGaps \
  --time-to-live-specification Enabled=true,AttributeName=ttl || echo "⚠️  TTL may already be enabled"

echo ""
echo "✅ DynamoDB setup complete!"
echo ""
echo "📋 Created tables:"
echo "  - AgentInteractions (with TTL)"
echo "  - AgentStrategies"
echo "  - ToolMetrics"
echo "  - StrategyConflicts (with TTL)"
echo "  - KnowledgeGaps (with TTL)"
echo ""
echo "💡 Tables are using PAY_PER_REQUEST billing mode"
echo "💰 Estimated cost: ~$18-20/month for 1000 interactions/day"
echo ""
echo "🔍 Verify tables with:"
echo "  aws dynamodb list-tables --region $REGION"
