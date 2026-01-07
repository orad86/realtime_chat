# Real-time AI Voice Chat

A web application that enables real-time voice conversations with an AI assistant capable of performing tasks. This project uses Next.js, WebRTC, and OpenAI's real-time API.

## Features

- Real-time two-way voice conversation with AI
- WebRTC for audio streaming
- Integration with OpenAI's GPT-4o-realtime API
- Task execution capabilities using LangChain tools
- Simple, intuitive user interface
- Fallback demo mode when API key is not available

## Prerequisites

- Node.js 18.x or later
- An OpenAI API key with access to the real-time API

## Setup

1. Clone the repository

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the root directory with your OpenAI API key:

```
OPENAI_API_KEY=your_openai_api_key_here
```

4. Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

## Usage

1. Click the microphone button to start a conversation
2. Speak naturally to the AI assistant
3. The AI will respond in real-time
4. You can ask the AI to perform tasks like checking the weather, managing calendar events, searching for information, or performing calculations
5. Click the stop button to end the conversation

## Architecture

This application follows a modern web architecture with a clear separation of concerns:

### Frontend (Client-Side)

- **React Components**: Built with Next.js and React, the UI is composed of functional components with hooks for state management.
- **WebRTC Client**: Handles peer connection setup, media streaming, and SDP negotiation with the server.
- **Speech Recognition**: Uses the Web Speech API to convert user's voice to text in real-time.
- **Speech Synthesis**: Uses the Web Speech API to convert AI text responses back to speech.

### Backend (Server-Side)

- **API Routes**: Next.js API routes provide serverless functions for handling requests.
- **WebRTC Signaling**: Processes SDP offers and generates SDP answers for establishing WebRTC connections.
- **OpenAI Integration**: Connects to OpenAI's GPT models for processing user queries.
- **LangChain Tools**: Provides task execution capabilities through specialized tools.

### Data Flow

```
┌─────────────┐     Speech      ┌──────────────┐    WebRTC     ┌────────────┐
│   User      │───Recognition───▶│   Frontend   │───Signaling───▶│  Backend   │
│ (Browser)   │                 │  (Next.js)   │               │ (API Routes)│
└─────────────┘                 └──────────────┘               └────────────┘
       ▲                               │                              │
       │                               │                              │
       │         Speech                │                              │
       └───────Synthesis───────────────┘                              ▼
                                                               ┌────────────┐
                                                               │  OpenAI    │
                                                               │   API      │
                                                               └────────────┘
```

## Algorithm Details

### WebRTC Connection Establishment

1. **SDP Offer Creation**:
   - The client creates a WebRTC peer connection
   - Requests microphone access via `getUserMedia()`
   - Adds audio tracks to the peer connection
   - Generates an SDP offer via `createOffer()`
   - Sets the local description with the offer

2. **Signaling**:
   - The SDP offer is sent to the server via the `/api/realtime` endpoint
   - The server processes the offer and generates an SDP answer
   - In demo mode, the server creates a simulated SDP answer
   - With OpenAI integration, the server forwards the offer to OpenAI's real-time API

3. **Connection Completion**:
   - The client receives the SDP answer
   - Sets the remote description with the answer
   - ICE candidates are exchanged automatically
   - The WebRTC connection is established

### Speech Processing Pipeline

1. **Speech Recognition**:
   - The Web Speech API's `SpeechRecognition` interface captures audio
   - Continuous recognition mode keeps listening for user speech
   - Speech is converted to text in real-time
   - Final transcripts are sent to the backend for processing

2. **Query Processing**:
   - User queries are sent to the `/api/gpt` endpoint
   - The OpenAI GPT model processes the query
   - Responses are returned to the frontend

3. **Speech Synthesis**:
   - The AI's text response is converted back to speech
   - The Web Speech API's `SpeechSynthesis` interface generates audio
   - The response is played back to the user

### Error Handling and Fallbacks

1. **API Key Validation**:
   - The application checks for a valid OpenAI API key
   - If no key is found, it falls back to demo mode

2. **Speech Recognition Recovery**:
   - Auto-restart mechanism for speech recognition errors
   - Handles "aborted" errors gracefully
   - Maintains continuous listening experience

3. **WebRTC Fallbacks**:
   - Demo mode provides a simulated SDP answer
   - Ensures the application works even without OpenAI API access

## File Structure

```
/app
  /api
    /gpt
      route.ts         # GPT query processing endpoint
    /realtime
      route.ts         # WebRTC signaling endpoint
    /tools
      route.ts         # LangChain tools endpoint
  /lib
    /langchain
      agent.ts         # LangChain agent implementation
      tools.ts         # Tool definitions for task execution
  page.tsx             # Main frontend component
```

## Building Custom Tools for the Assistant

The AI assistant can be extended with custom tools to perform specific tasks. This section explains how to build and integrate new tools.

### Tool Architecture

Tools are implemented using LangChain's `Tool` class and follow a standard pattern:

1. **Tool Definition**: A class that extends `Tool` from LangChain
2. **Tool Registration**: Adding the tool to the available tools array
3. **Tool Selection**: Logic to identify when to use the tool based on user queries
4. **Tool Execution**: The actual implementation of the tool's functionality

### Creating a New Tool

1. **Define the Tool Class**

```typescript
import { Tool } from "@langchain/core/tools";

export class MyCustomTool extends Tool {
  name = "my_custom_tool";
  description = "Description of what this tool does and when to use it";
  
  async _call(input: string) {
    // Implement the tool's functionality here
    // Process the input and return a result
    try {
      // Your implementation logic
      const result = await processInput(input);
      return `Here is the result: ${result}`;
    } catch (error) {
      return `Error using ${this.name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
```

2. **Register the Tool**

Add your tool to the tools array in `/app/lib/langchain/tools.ts`:

```typescript
// Export all tools
export const tools = [
  new WeatherTool(),
  new CalendarTool(),
  new SearchTool(),
  new CalculatorTool(),
  new MyCustomTool() // Add your new tool here
];
```

3. **Update Tool Selection Logic**

Modify the `identifyTool` function in `/app/lib/langchain/agent.ts` to recognize when to use your tool:

```typescript
function identifyTool(query: string) {
  const lowerQuery = query.toLowerCase();
  
  // Existing tool identification logic...
  
  // Check for your custom tool queries
  if (lowerQuery.includes("custom keyword") || lowerQuery.match(/your regex pattern/)) {
    const customInput = query.replace(/custom keyword|your regex pattern/gi, "").trim();
    return { tool: tools[4], input: customInput }; // Index of your tool in the tools array
  }
  
  return null;
}
```

### Tool Best Practices

1. **Error Handling**: Always implement robust error handling in your tools
2. **Input Validation**: Validate and sanitize inputs before processing
3. **Clear Descriptions**: Provide clear descriptions so the agent knows when to use your tool
4. **Focused Functionality**: Each tool should do one thing well
5. **Meaningful Responses**: Return formatted, user-friendly responses
6. **Logging**: Include appropriate logging for debugging

### Example: Creating a Translation Tool

```typescript
import { Tool } from "@langchain/core/tools";

export class TranslationTool extends Tool {
  name = "translator";
  description = "Translates text from one language to another";
  
  async _call(input: string) {
    try {
      // Parse input to get source language, target language, and text
      const match = input.match(/translate from (\w+) to (\w+): (.+)/i);
      
      if (!match) {
        return "Please provide input in the format: 'translate from [source] to [target]: [text]'";
      }
      
      const [, sourceLang, targetLang, text] = match;
      
      // In a real implementation, call a translation API
      // For demo purposes, we'll just return a mock response
      return `Translation from ${sourceLang} to ${targetLang}: [Translated text would appear here]`;
    } catch (error) {
      return `Error translating text: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
```

### Integrating External APIs in Tools

To integrate external APIs in your tools:

1. **Install Required Packages**:
   ```bash
   npm install axios
   ```

2. **Create API Client**:
   ```typescript
   import axios from 'axios';
   
   const apiClient = axios.create({
     baseURL: 'https://api.example.com',
     headers: {
       'Authorization': `Bearer ${process.env.API_KEY}`,
       'Content-Type': 'application/json'
     }
   });
   ```

3. **Use in Tool Implementation**:
   ```typescript
   async _call(input: string) {
     try {
       const response = await apiClient.get(`/endpoint?query=${encodeURIComponent(input)}`);
       return response.data.result;
     } catch (error) {
       return `API error: ${error instanceof Error ? error.message : String(error)}`;
     }
   }
   ```

4. **Add Environment Variables**:
   Add any required API keys to your `.env` file:
   ```
   API_KEY=your_api_key_here
   ```

## Learn More

To learn more about the technologies used in this project:

- [WebRTC Web APIs](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [OpenAI API Documentation](https://platform.openai.com/docs/api-reference)
- [LangChain Documentation](https://js.langchain.com/docs/)
- [Next.js Documentation](https://nextjs.org/docs)

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
