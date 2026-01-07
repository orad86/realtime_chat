// Simple in-memory store for conversation history
// In a production app, this would be replaced with a database

type Message = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type ConversationStore = {
  [sessionId: string]: Message[];
};

// In-memory store for conversations
const conversations: ConversationStore = {};

// Default system message
const DEFAULT_SYSTEM_MESSAGE = {
  role: 'system' as const,
  content: 'You are a helpful assistant that provides concise and accurate responses. Your answers should be informative but brief enough to be spoken aloud.'
};

// Get conversation history for a session
export function getConversation(sessionId: string): Message[] {
  // Create a new conversation if it doesn't exist
  if (!conversations[sessionId]) {
    conversations[sessionId] = [DEFAULT_SYSTEM_MESSAGE];
  }
  
  return conversations[sessionId];
}

// Add a message to the conversation
export function addMessage(sessionId: string, role: 'user' | 'assistant', content: string): void {
  const conversation = getConversation(sessionId);
  conversation.push({ role, content });
  
  // Limit conversation length to prevent memory issues (keep last 20 messages plus system message)
  if (conversation.length > 21) {
    const systemMessage = conversation[0];
    conversations[sessionId] = [systemMessage, ...conversation.slice(-20)];
  }
}

// Reset a conversation
export function resetConversation(sessionId: string): void {
  conversations[sessionId] = [DEFAULT_SYSTEM_MESSAGE];
}

// Get all messages for a conversation
export function getAllMessages(sessionId: string): Message[] {
  return getConversation(sessionId);
}
