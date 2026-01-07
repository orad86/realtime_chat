import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getConversation, addMessage, resetConversation, getAllMessages } from '../../lib/memory/conversation';
import { v4 as uuidv4 } from 'uuid';

// Initialize OpenAI client
const getOpenAIClient = () => {
  // Check if API key is available
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    console.warn('OpenAI API key not found.');
    return null;
  }
  
  return new OpenAI({ apiKey });
};

const openai = getOpenAIClient();

export async function POST(request: NextRequest) {
  try {
    // Parse the request body to get the query
    const body = await request.json();
    const { query, resetContext } = body;
    
    // Get or create session ID from cookies
    const cookies = request.cookies;
    let sessionId = cookies.get('session_id')?.value;
    
    if (!sessionId) {
      // Generate a new session ID if none exists
      sessionId = uuidv4();
    }
    
    // Handle reset context request
    if (resetContext) {
      resetConversation(sessionId);
      return NextResponse.json({
        result: 'Conversation context has been reset.',
        sessionId
      });
    }
    
    // Require query for normal operation
    if (!query) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }
    
    // Check if OpenAI client is available
    if (!openai) {
      return NextResponse.json(
        { error: 'OpenAI API key not found' },
        { status: 500 }
      );
    }
    
    // Add user query to conversation
    addMessage(sessionId, 'user', query);
    
    // Get all messages for this conversation
    const messages = getAllMessages(sessionId);
    
    // Process the query using OpenAI's GPT model with conversation history
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      temperature: 0.7,
      max_tokens: 150,
    });
    
    const responseContent = completion.choices[0].message.content || '';
    
    // Add assistant response to conversation
    addMessage(sessionId, 'assistant', responseContent);
    
    // Create response with a Set-Cookie header to persist the session ID
    const response = NextResponse.json({ 
      result: responseContent,
      sessionId
    });
    
    // Set session ID cookie if it doesn't exist
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
    console.error('Error processing GPT request:', error);
    
    // Return appropriate error response
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    );
  }
}
