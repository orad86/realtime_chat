import { NextRequest, NextResponse } from 'next/server';
import { handleQuery } from '../../lib/langchain/agent';

export async function POST(request: NextRequest) {
  try {
    // Parse the request body to get the query
    const body = await request.json();
    const { query } = body;
    
    if (!query) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }
    
    // Process the query using our tool executor
    const result = await handleQuery(query);
    
    // Return the result
    return NextResponse.json({ result });
    
  } catch (error) {
    console.error('Error processing tool request:', error);
    
    // Return appropriate error response
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    );
  }
}
