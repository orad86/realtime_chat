import { handlers } from '@orad86/ai-aero-tools';

// Wrapper for create_document that ensures S3 URLs are returned
const createDocumentWrapper = {
  definition: {
    type: 'function',
    function: {
      name: 'create_document',
      description: 'Create a formatted PDF document from markdown, JSON, or text content. Saves to S3 and returns a web-accessible URL for downloading.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The content to convert to PDF. Can be markdown, JSON, or plain text.'
          },
          format: {
            type: 'string',
            enum: ['markdown', 'json', 'text'],
            description: 'The format of the input content.',
            default: 'markdown'
          },
          title: {
            type: 'string',
            description: 'Document title for the PDF header and filename.'
          },
          filename: {
            type: 'string',
            description: 'Base filename (without extension). Will be sanitized automatically.'
          }
        },
        required: ['content']
      }
    }
  },
  execute: async (input: any) => {
    try {
      console.log('[create-document-wrapper] Environment check:', {
        S3_DOCS_BUCKET: process.env.S3_DOCS_BUCKET,
        AWS_REGION: process.env.AWS_REGION,
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ? 'SET' : 'NOT SET'
      });
      console.log('[create-document-wrapper] Calling handler with input:', input);
      
      // Call the handler directly - it should use S3 with env vars
      const result = await handlers.create_document(input);
      
      console.log('[create-document-wrapper] Handler result:', result);
      
      if (result.success && result.data?.link) {
        console.log('[create-document-wrapper] ✅ S3 URL:', result.data.link);
      }
      
      if (!result.success) {
        return {
          tool: 'create_document',
          success: false,
          error: result.error
        };
      }
      
      // The handler should return S3 URL in result.data.link
      return {
        tool: 'create_document',
        success: true,
        data: result.data
      };
      
    } catch (error) {
      console.error('[create-document-wrapper] Error:', error);
      return {
        tool: 'create_document',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }
};

export { createDocumentWrapper };
