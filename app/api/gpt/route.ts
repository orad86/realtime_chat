import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getConversation, addMessage, resetConversation, getAllMessages } from '../../lib/memory/conversation';
import { v4 as uuidv4 } from 'uuid';
import { handleQuery as handleAviationQuery, handleQueryStreaming } from '../../lib/langchain/agent';
import { handlers } from '@orad86/ai-aero-tools';

const getOpenAIClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? new OpenAI({ apiKey }) : null;
};

const openai = getOpenAIClient();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, resetContext, streaming = true, fileUpload, history: clientHistory } = body;
    
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

    // Handle file upload directly
    if (fileUpload) {
      try {
        console.log('[API] Processing file upload:', fileUpload.fileName);
        
        // Directly call the upload_document tool
        const uploadResult = await handlers.upload_document({
          base64Content: fileUpload.base64Content,
          fileName: fileUpload.fileName,
          mimeType: fileUpload.mimeType,
          analyzeOnUpload: true
        });
        
        console.log('[API] Upload result:', uploadResult);
        
        // Add user message about upload with document ID for agent context
        const docId = uploadResult.data?.id || 'unknown';
        addMessage(sessionId, 'user', `📎 Uploaded file "${fileUpload.fileName}" - Document ID: ${docId}`);
        
        // Create response message
        let responseMessage = '';
        if (uploadResult.success && uploadResult.data) {
          const data = uploadResult.data;
          responseMessage = `✅ Successfully uploaded **${data.originalName || fileUpload.fileName}**!\n\n`;
          responseMessage += `- **Document ID:** \`${data.id}\`\n`;
          responseMessage += `- **Type:** ${data.documentType || data.mimeType}\n`;
          responseMessage += `- **Size:** ${(data.size / 1024).toFixed(1)} KB\n`;
          
          // Build S3 URL
          const s3Url = `https://${data.s3Bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${data.s3Key}`;
          responseMessage += `- **URL:** [View Document](${s3Url})\n`;
          
          // Show analysis if available
          if (data.analysisResult) {
            responseMessage += `\n### 📊 Analysis\n`;
            responseMessage += `- **Title:** ${data.analysisResult.title || 'N/A'}\n`;
            responseMessage += `- **Summary:** ${data.analysisResult.summary || 'N/A'}\n`;
            if (data.analysisResult.extractedData) {
              responseMessage += `- **Extracted Data:** ${JSON.stringify(data.analysisResult.extractedData, null, 2)}\n`;
            }
          }
          
          responseMessage += `\n💡 *Use document ID \`${data.id}\` to reference this document in future requests.*`;
        } else {
          responseMessage = `❌ Upload failed: ${uploadResult.error || 'Unknown error'}`;
        }
        
        addMessage(sessionId, 'assistant', responseMessage);
        
        const response = NextResponse.json({
          result: responseMessage,
          chunks: [responseMessage],
          hasMore: false,
          toolResults: [{
            toolName: 'upload_document',
            success: uploadResult.success,
            result: uploadResult
          }],
          sessionId
        });
        
        if (!cookies.get('session_id')) {
          response.cookies.set({
            name: 'session_id',
            value: sessionId,
            httpOnly: true,
            maxAge: 60 * 60 * 24 * 7,
            path: '/',
          });
        }
        
        return response;
      } catch (uploadError) {
        console.error('[API] File upload error:', uploadError);
        const errorMessage = `❌ Upload failed: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`;
        addMessage(sessionId, 'assistant', errorMessage);
        return NextResponse.json({
          result: errorMessage,
          chunks: [errorMessage],
          hasMore: false,
          sessionId
        });
      }
    }

    // Use client-provided history if available (reliable), fall back to in-memory store
    let openAiHistory: any[];
    if (clientHistory && Array.isArray(clientHistory) && clientHistory.length > 0) {
      // Client sends full conversation history - use it directly
      openAiHistory = clientHistory;
      console.log(`[API] Using client-provided history: ${clientHistory.length} messages`);
    } else {
      // Fallback to in-memory store (may be empty on serverless cold start)
      addMessage(sessionId, 'user', query);
      const history = getAllMessages(sessionId);
      openAiHistory = history.map(m => ({ role: m.role, content: m.content }));
      console.log(`[API] Using in-memory history: ${openAiHistory.length} messages`);
    }

    // Use streaming function for more natural responses
    let toolResults: any[] = [];
    if (streaming) {
      const streamingResponse = await handleQueryStreaming(openAiHistory as any, sessionId);
      chunks = streamingResponse.chunks;
      hasMore = streamingResponse.hasMore;
      toolResults = streamingResponse.toolResults || [];
      
      // Remove spaces from all https URLs in markdown links
      chunks = chunks.map(chunk => {
        return chunk.replace(/\[([^\]]+)\]\((https:\/\/[^\)]+)\)/g, (match, text, url) => {
          const cleanUrl = url.replace(/\s+/g, '');
          return `[${text}](${cleanUrl})`;
        });
      });
      responseContent = chunks.join('\n\n'); // Store full response, not just first chunk
    } else {
      // Fallback to original function
      responseContent = await handleAviationQuery(openAiHistory as any);
      // Fix URLs with spaces
      responseContent = responseContent.replace(/\[([^\]]+)\]\((https:\/\/[^\)]+)\)/g, (match, text, url) => {
        const cleanUrl = url.replace(/\s+/g, '');
        return `[${text}](${cleanUrl})`;
      });
    }

    // Also update in-memory store as backup
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
