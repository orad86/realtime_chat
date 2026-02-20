# Real-time Aviation AI Voice Assistant

A web application that enables real-time voice and text conversations with an aviation-focused AI assistant. The assistant uses OpenAI GPT-4o with function calling, integrates the `@orad86/ai-aero-tools` package for aviation tools, and uses OpenAI neural TTS for natural-sounding voice responses.

## Features

- Real-time two-way voice and text conversation with an aviation-focused AI assistant
- OpenAI GPT-4o with function calling
- Integration with `@orad86/ai-aero-tools` for aviation tools (airports, weather, NOTAMs, routing, pilot history, professional guidelines, etc.)
- OpenAI neural TTS (`gpt-4o-mini-tts`, voice `verse`) for natural audio responses
- Conversation memory for context retention per session
- Dark-themed, intuitive user interface

## Prerequisites

- Node.js 18.x or later
- An OpenAI API key
- (Optional) Any additional environment variables required by `@orad86/ai-aero-tools` (for example, for external aviation APIs)

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

1. Open the app in your browser.
2. Use the text input or microphone button to ask aviation-related questions (flight planning, weather, NOTAMs, routing, pilot history, etc.).
3. The AI will respond concisely in text and, when enabled, via neural TTS.
4. The assistant is constrained to aviation-related topics and will use tools from `@orad86/ai-aero-tools` when appropriate.
5. Conversation history is maintained per session for more contextual responses.
6. Use the UI controls to stop or reset the conversation as needed.

## Architecture

This application follows a modern web architecture with a clear separation of concerns:

### Frontend (Client-Side)

- **React Components**: Built with Next.js and React, the UI is composed of functional components with hooks for state management.
- **Voice & Text Input**: Users can either type questions or use the microphone button to capture audio (browser speech recognition or other capture methods).
- **Neural TTS Playback**: The frontend calls `/api/tts` to obtain MP3 audio synthesized by OpenAI and plays it back to the user.

### Backend (Server-Side)

- **API Routes**: Next.js API routes provide serverless functions for handling requests.
- **OpenAI Integration**: Connects to OpenAI's GPT models (GPT-4o) for processing user queries.
- **Aviation Tools Integration**: Uses `@orad86/ai-aero-tools` for aviation-specific data (airports, weather, NOTAMs, routing, pilot history, and more) via OpenAI function calling.
- **Memory System**: Maintains conversation context across interactions using an in-memory store keyed by session.
- **Neural TTS Endpoint**: `/api/tts` wraps OpenAI TTS (`gpt-4o-mini-tts`) and streams MP3 audio back to the client.

### High-Level Data Flow

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

### Chat & Tool Use Flow

1. **User Message (Text or Transcribed Audio)**:
   - The frontend collects either typed text or recognized speech.
   - The message is appended to the session conversation history.
   - The message is sent to `/api/gpt`.

2. **Signaling**:
   - The server builds a message history including a system prompt that constrains the assistant to aviation topics.
   - The server calls OpenAI GPT-4o with the aviation tools from `@orad86/ai-aero-tools`.
   - If the model decides to call tools, the server executes the corresponding handlers from the tools package, logs the results, and feeds them back to the model.
   - The final assistant response is returned to the frontend.

### Speech Processing & TTS Pipeline

1. **Speech Capture & Recognition**:
   - The browser captures audio when the microphone is active.
   - Audio is transcribed to text on the client or via future server-side improvements.
   - Transcripts are sent to the backend as chat messages.

2. **Query Processing**:
   - User queries are sent to the `/api/gpt` endpoint along with the session history.
   - The OpenAI GPT model (GPT-4o) processes the query and may invoke aviation tools.
   - A concise, conversational response is returned to the frontend.

3. **Neural Speech Synthesis**:
   - The frontend calls `/api/tts` with the assistant's reply text.
   - The server uses OpenAI TTS (`gpt-4o-mini-tts`, voice `verse`) to synthesize MP3 audio.
   - The browser plays the returned audio for a natural-sounding voice.

### Error Handling and Conversation Memory

1. **API Key Validation**:
   - The application checks for a valid OpenAI API key
   - Provides clear error messages if the key is missing or invalid

2. **Speech Recognition Recovery**:
   - Auto-restart mechanism for speech recognition errors
   - Handles "aborted" errors gracefully
   - Maintains continuous listening experience

3. **Conversation Memory System**:
   - Server-side memory storage for conversation history
   - Session management using HTTP cookies
   - Automatic context retention between interactions
   - Reset functionality to start fresh conversations

## File Structure

```
/app
  /api
    /gpt
      route.ts         # Aviation GPT query processing endpoint (uses tools + memory)
    /realtime
      route.ts         # WebRTC signaling endpoint (experimental / legacy)
    /tts
      route.ts         # OpenAI neural TTS endpoint
  /lib
    /langchain
      agent.ts         # Aviation agent logic, tool execution, and response formatting
    /memory
      conversation.ts  # Server-side conversation memory system
  page.tsx             # Main frontend component (voice + text UI)
```

## Aviation Tools Integration

The AI assistant uses the external `@orad86/ai-aero-tools` package to provide aviation-specific capabilities. The tools are exposed to OpenAI via the function-calling `tools` parameter, and handlers execute real logic when the model calls them.

#### How It Works

1. **Starting an Examination**: The tool is activated when users mention keywords like "start ICAO examination" or "begin aviation English test".

2. **Interactive Conversation**: Unlike a single-sample assessment, this tool:
   - Creates a dedicated examination session with a unique ID
   - Simulates an ICAO examiner who asks questions and presents scenarios
   - Maintains context throughout the conversation
   - Covers multiple aviation topics to test different aspects of language proficiency

3. **Dynamic Assessment**: The examiner (powered by GPT) will:
   - Gradually increase complexity to test different language skills
   - Present unexpected situations to test comprehension and ability to handle non-routine communications
   - Continue the conversation until sufficient evidence has been gathered (typically 5-7 exchanges)
   - Decide when to end the test and provide a final assessment

4. **Comprehensive Evaluation**: At the end of the examination, the tool provides:
   - Overall ICAO level (1-6)
   - Individual scores for each criterion (pronunciation, structure, vocabulary, fluency, comprehension, interactions)
   - Analysis of strengths and weaknesses
   - Specific recommendations for improvement

#### Example Usage

**To start an examination:**
```
Start ICAO aviation English examination
```

**To respond during the examination:**
```
Session icao-abc123: As the captain of flight 372, I've noticed our fuel consumption is higher than expected. We may need to consider diverting to our alternate airport if the headwinds continue to increase.
```

**To check examination status:**
```
Check status for session icao-abc123
```

This conversation-based approach provides a much more authentic assessment of aviation English proficiency compared to single-sample evaluation, as it tests the applicant's ability to maintain communication over time and handle a variety of aviation scenarios.

### Tool Architecture

Tools in this project are defined in `@orad86/ai-aero-tools` using the OpenAI function-calling schema. In this app:

1. **Tool Definitions**: The `tools` array from `@orad86/ai-aero-tools` is passed directly to OpenAI as the `tools` parameter.
2. **Handlers Map**: A `handlers` object maps tool names to their execution functions.
3. **Tool Execution**: When OpenAI requests a tool call, the server parses arguments, invokes the relevant handler, logs the result, and feeds a summarized `tool_result` back into the model.
4. **Conversational Use**: The assistant treats tool outputs as internal data and responds to the user in a natural, concise aviation context instead of dumping raw JSON.

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
// Export tools
export const tools = [
  new CalculatorTool(), // Currently only the calculator tool is implemented
  new MyCustomTool() // Add your new tool here
];
```

3. **Update Tool Selection Logic**

Modify the `identifyTool` function in `/app/lib/langchain/agent.ts` to recognize when to use your tool:

```typescript
function identifyCalculation(query: string) {
  const lowerQuery = query.toLowerCase();
  
  // Check for calculation patterns
  if (lowerQuery.includes("calculate") || 
      lowerQuery.includes("how much is") ||
      lowerQuery.match(/[0-9]\s*[+\-*\/]\s*[0-9]/)) {
    
    // Extract and process the mathematical expression
    let mathExpression = query.replace(
      /calculate|compute|what\s+is|how\s+much\s+is/gi, 
      ""
    ).trim();
    
    // Your custom tool logic would go here
    return mathExpression;
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

- [OpenAI API Documentation](https://platform.openai.com/docs/api-reference)
- [`@orad86/ai-aero-tools` Repository](https://github.com/orad86/ai-aero-tools)
- [LangChain Documentation](https://js.langchain.com/docs/)
- [Next.js Documentation](https://nextjs.org/docs)

## Deployment

This application is deployed on Netlify at: https://realtime-ai-voice-chat.netlify.app

### Deploy on Netlify

To deploy your own version on Netlify:

1. Push your code to a GitHub repository
2. Connect your repository to Netlify
3. Configure the build settings:
   - Build command: `npm run build`
   - Publish directory: `.next`
4. Add your OpenAI API key as an environment variable named `OPENAI_API_KEY`
5. Deploy the site

### Deploy on Vercel

Alternatively, you can deploy on Vercel:

1. Push your code to a GitHub repository
2. Import the project on [Vercel](https://vercel.com/new)
3. Add your OpenAI API key as an environment variable
4. Deploy the site
