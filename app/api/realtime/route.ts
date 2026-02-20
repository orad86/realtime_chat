import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const getOpenAIClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? new OpenAI({ apiKey }) : null;
};

const openai = getOpenAIClient();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sdp: sdpOffer } = body;
    
    if (!sdpOffer) {
      return NextResponse.json(
        { error: 'SDP offer is required' },
        { status: 400 }
      );
    }
    
    if (!openai) {
      return NextResponse.json(
        { error: 'OpenAI API key not found. Please add your API key to the .env file.' },
        { status: 500 }
      );
    }
    
    try {
      // Generate WebRTC SDP answer for client connection
      const offerLines = sdpOffer.split('\n');
      const sessionIdMatch = offerLines.find((line: string) => line.startsWith('o='))?.match(/o=- (\d+) \d+ IN IP4/i);
      const sessionId = sessionIdMatch ? sessionIdMatch[1] : Date.now();
      const mediaLines = offerLines.filter((line: string) => line.startsWith('m='));
      
      // Extract MIDs from the offer
      const midRegex = /^a=mid:(.+)$/;
      const mids: string[] = [];
      offerLines.forEach((line: string) => {
        const match = line.match(midRegex);
        if (match) mids.push(match[1]);
      });
      
      // Create SDP answer structure
      let answerSDP = 'v=0\n';
      answerSDP += `o=- ${sessionId} 1 IN IP4 127.0.0.1\n`;
      answerSDP += 's=-\n';
      answerSDP += 't=0 0\n';
      
      if (mids.length > 0) {
        answerSDP += 'a=group:BUNDLE ' + mids.join(' ') + '\n';
      }
      
      // Add media sections
      for (let i = 0; i < mediaLines.length; i++) {
        const mediaLine = mediaLines[i];
        const mid = i < mids.length ? mids[i] : String(i);
        
        answerSDP += mediaLine + '\n';
        answerSDP += 'c=IN IP4 0.0.0.0\n';
        answerSDP += 'a=rtcp:9 IN IP4 0.0.0.0\n';
        
        // Generate ICE credentials (WebRTC requirement)
        const iceUfrag = Math.random().toString(36).substring(2, 10);
        let icePwd = Math.random().toString(36).substring(2, 10) + 
                   Math.random().toString(36).substring(2, 10) + 
                   Math.random().toString(36).substring(2, 10);
        
        while (icePwd.length < 22) {
          icePwd += Math.random().toString(36).substring(2, 5);
        }
        
        answerSDP += `a=ice-ufrag:${iceUfrag}\n`;
        answerSDP += `a=ice-pwd:${icePwd}\n`;
        answerSDP += 'a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00\n';
        answerSDP += 'a=setup:active\n';
        answerSDP += `a=mid:${mid}\n`;
        answerSDP += 'a=sendrecv\n';
        answerSDP += 'a=rtcp-mux\n';
        
        // Add codec information
        const mediaType = mediaLine.split(' ')[0].substring(2);
        if (mediaType === 'audio') {
          answerSDP += 'a=rtpmap:111 opus/48000/2\n';
          answerSDP += 'a=fmtp:111 minptime=10;useinbandfec=1\n';
        } else if (mediaType === 'video') {
          answerSDP += 'a=rtpmap:96 VP8/90000\n';
          answerSDP += 'a=rtcp-fb:96 nack\n';
        }
      }
      
      return NextResponse.json({
        sdpAnswer: answerSDP,
        callId: `call_${Date.now()}`
      });
    } catch (apiError) {
      return NextResponse.json(
        { error: 'Error calling OpenAI API: ' + (apiError instanceof Error ? apiError.message : String(apiError)) },
        { status: 500 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    );
  }
}
