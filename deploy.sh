#!/bin/bash

echo "🚀 Deploying memory system changes..."
echo ""

# Stage all changes
echo "📦 Staging files..."
git add app/lib/langchain/agent.ts
git add app/lib/memory/injection.ts
git add app/lib/memory/log-interaction.ts
git add scripts/run-learning-job.js

# Commit
echo "💾 Committing changes..."
git commit -m "feat: enable full memory system with personal info retention

- Add memory awareness to agent system prompt
- Log ALL interactions (not just tool-using ones)
- Agent can now remember personal information (name, email, preferences)
- Show confidence scores on learned strategies
- Fix DynamoDB reserved keyword error for 'processed'
- Enhanced strategy injection with experience labels
- Add helper script for running learning job"

# Push
echo "⬆️  Pushing to GitHub..."
git push origin main

echo ""
echo "✅ Deployment complete!"
echo "🔗 Vercel will auto-deploy: https://realtime-chat-henna.vercel.app"
echo ""
echo "Next steps:"
echo "1. Wait 1-2 minutes for Vercel deployment"
echo "2. Run learning job: node scripts/run-learning-job.js"
echo "3. Test agent memory with personal info"
