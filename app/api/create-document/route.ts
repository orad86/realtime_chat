import { NextRequest, NextResponse } from 'next/server';
import { tools, handlers } from '@orad86/ai-aero-tools';
import { S3Client, CreateBucketCommand, PutBucketCorsCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import path from 'path';
import fs from 'fs';

export async function POST(request: NextRequest) {
  try {
    // Debug environment variables
    console.log('Environment variables:', {
      S3_DOCS_BUCKET: process.env.S3_DOCS_BUCKET,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ? 'SET' : 'NOT SET',
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ? 'SET' : 'NOT SET',
      AWS_REGION: process.env.AWS_REGION || 'NOT SET'
    });

    // Ensure S3 bucket exists
    const bucketName = process.env.S3_DOCS_BUCKET;
    if (bucketName) {
      const s3Client = new S3Client({
        region: process.env.AWS_REGION || 'eu-north-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
        }
      });

      try {
        // Check if bucket exists
        await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
        console.log('✅ Bucket exists');
      } catch (error: any) {
        if (error.name === 'NoSuchBucket' || error.$metadata?.httpStatusCode === 404) {
          console.log('🪣 Creating bucket in', process.env.AWS_REGION || 'eu-north-1');
          
          const createCommand = new CreateBucketCommand({ 
            Bucket: bucketName,
            ...(process.env.AWS_REGION !== 'us-east-1' && {
              CreateBucketConfiguration: {
                LocationConstraint: process.env.AWS_REGION as any
              }
            })
          });
          
          await s3Client.send(createCommand);
          console.log('✅ Bucket created successfully');

          // Set CORS configuration
          const corsCommand = new PutBucketCorsCommand({
            Bucket: bucketName,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedHeaders: ['*'],
                  AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
                  AllowedOrigins: ['*'],
                  ExposeHeaders: []
                }
              ]
            }
          });
          await s3Client.send(corsCommand);
          console.log('✅ CORS configuration set');
        } else {
          console.error('❌ Error checking bucket:', error.message);
        }
      }
    }
    
    const { content, format, title, filename } = await request.json();
    
    // Create the document using the tool handler
    const result = await handlers.create_document({ content, format, title, filename });
    
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    
    // The tool should now return S3 URLs directly
    return NextResponse.json({
      success: true,
      data: result.data
    });
    
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    );
  }
}
