import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getConversation, addMessage, resetConversation, getAllMessages } from '../../lib/memory/conversation';
import { v4 as uuidv4 } from 'uuid';
import { handleQuery as handleAviationQuery, handleQueryStreaming } from '../../lib/langchain/agent';

const getOpenAIClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? new OpenAI({ apiKey }) : null;
};

const openai = getOpenAIClient();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, resetContext, streaming = true } = body;
    
    const cookies = request.cookies;
    let sessionId = cookies.get('session_id')?.value;
    
    if (!sessionId) {
      sessionId = uuidv4();
    }
    
    if (resetContext) {
      resetConversation(sessionId);
      return NextResponse.json({
        result: 'Conversation context has been reset.',
        sessionId
      });
    }
    
    if (!query) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }
    
    let responseContent: string;
    let chunks: string[] = [];
    let hasMore: boolean = false;

    // Add the user's message to the in-memory conversation
    addMessage(sessionId, 'user', query);
    const history = getAllMessages(sessionId);

    // Map our stored messages into OpenAI chat message format
    const openAiHistory = history.map(m => ({ role: m.role, content: m.content }));

    // Use streaming function for more natural responses
    let toolResults: any[] = [];
    if (streaming) {
      const streamingResponse = await handleQueryStreaming(openAiHistory as any, sessionId);
      chunks = streamingResponse.chunks;
      hasMore = streamingResponse.hasMore;
      toolResults = streamingResponse.toolResults || [];
      responseContent = chunks[0] || ''; // First chunk for immediate response
      
      // Remove spaces from all https URLs in markdown links
      chunks = chunks.map(chunk => {
        return chunk.replace(/\[([^\]]+)\]\((https:\/\/[^\)]+)\)/g, (match, text, url) => {
          const cleanUrl = url.replace(/\s+/g, '');
          return `[${text}](${cleanUrl})`;
        });
      });
      responseContent = chunks[0] || '';
    } else {
      // Fallback to original function
      responseContent = await handleAviationQuery(openAiHistory as any);
      // Fix URLs with spaces
      responseContent = responseContent.replace(/\[([^\]]+)\]\((https:\/\/[^\)]+)\)/g, (match, text, url) => {
        const cleanUrl = url.replace(/\s+/g, '');
        return `[${text}](${cleanUrl})`;
      });
    }

    // Store the first chunk (or full response) back into conversation history
    addMessage(sessionId, 'assistant', responseContent);
    
    const response = NextResponse.json({ 
      result: responseContent,
      chunks: streaming ? chunks : [responseContent],
      hasMore: streaming ? hasMore : false,
      toolResults,
      sessionId
    });
    
    if (!cookies.get('session_id')) {
      response.cookies.set({
        name: 'session_id',
        value: sessionId,
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 7, // 1 week
        path: '/',
      });
    }
    
    return response;
    
  } catch (error) {
    console.error('[API] Error in /api/gpt:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    );
  }
}
