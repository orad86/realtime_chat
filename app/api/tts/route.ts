import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();
    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const speech = await client.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: 'coral',
      input: text,
    });

    const audioBuffer = Buffer.from(await speech.arrayBuffer());

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length.toString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'TTS error' },
      { status: 500 },
    );
  }
}
