"use client";

import { useState, useRef, useEffect } from "react";

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [status, setStatus] = useState("idle");
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  // WebRTC references
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  
  // Function to speak the AI response using the Web Speech API
  const speakResponse = (text: string) => {
    // Check if the browser supports speech synthesis
    if ('speechSynthesis' in window) {
      // Create a new speech synthesis utterance
      const utterance = new SpeechSynthesisUtterance(text);
      
      // Configure the utterance for a more natural, less robotic sound
      utterance.lang = 'en-US';
      utterance.rate = 0.95; // Slightly slower than normal for more natural cadence
      utterance.pitch = 1.05; // Slightly higher pitch for a more human-like tone
      utterance.volume = 1.0; // Full volume
      
      // Get available voices
      const voices = window.speechSynthesis.getVoices();
      
      // Log available voices for debugging
      console.log('Available voices:', voices.map(v => v.name));
      
      // Try to find the most natural-sounding voice
      // Priority: Google Neural voices > Apple voices > Microsoft voices > Any female voice
      const preferredVoice = voices.find(voice => 
        voice.name.includes('Google US English Female') ||
        voice.name.includes('Google UK English Female') ||
        voice.name.includes('Samantha') ||
        voice.name.includes('Ava') ||
        voice.name.includes('Allison') ||
        voice.name.includes('Microsoft Zira') ||
        voice.name.includes('Female')
      );
      
      if (preferredVoice) {
        console.log('Using voice:', preferredVoice.name);
        utterance.voice = preferredVoice;
      }
      
      // Speak the text
      window.speechSynthesis.speak(utterance);
      
      // Log when speech starts and ends
      utterance.onstart = () => console.log('Speech started');
      utterance.onend = () => console.log('Speech ended');
      utterance.onerror = (event) => console.error('Speech error:', event);
    } else {
      console.warn('Speech synthesis not supported in this browser');
    }
  };
  
  // Function to start the conversation
  const startConversation = async () => {
    try {
      setStatus("connecting");
      
      // Initialize WebRTC peer connection
      const configuration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
      const peerConnection = new RTCPeerConnection(configuration);
      peerConnectionRef.current = peerConnection;
      
      // Get user media (microphone access)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      
      // Add audio track to peer connection
      stream.getAudioTracks().forEach(track => {
        peerConnection.addTrack(track, stream);
      });
      
      // Create and set local description (offer)
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      
      // Send offer to server and get answer
      setStatus("waiting for OpenAI");
      
      try {
        // Send SDP offer to our backend API
        const response = await fetch('/api/realtime', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sdp: peerConnection.localDescription?.sdp,
          }),
        });
        
        // Check for errors
        if (!response.ok) {
          let errorMessage = response.statusText;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (e) {
            // If response is not JSON, use status text
          }
          throw new Error(`API error: ${errorMessage}`);
        }
        
        // Parse response
        const responseData = await response.json();
        const { sdpAnswer, callId } = responseData;
        
        // Log connection status
        console.log('WebRTC connection established with OpenAI real-time API');
        
        // Set up speech recognition for transcribing user speech
        // Define types for the Web Speech API
        interface SpeechRecognitionEvent extends Event {
          resultIndex: number;
          results: SpeechRecognitionResultList;
        }
        
        interface SpeechRecognitionResult {
          isFinal: boolean;
          [index: number]: SpeechRecognitionAlternative;
        }
        
        interface SpeechRecognitionResultList {
          length: number;
          [index: number]: SpeechRecognitionResult;
        }
        
        interface SpeechRecognitionAlternative {
          transcript: string;
          confidence: number;
        }
        
        interface SpeechRecognitionErrorEvent extends Event {
          error: string;
          message: string;
        }
        
        interface SpeechRecognition extends EventTarget {
          continuous: boolean;
          interimResults: boolean;
          lang: string;
          start(): void;
          stop(): void;
          onresult: (event: SpeechRecognitionEvent) => void;
          onerror: (event: SpeechRecognitionErrorEvent) => void;
          onend: () => void;
        }
        
        // Get the Speech Recognition API with type assertion
        const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        
        if (SpeechRecognitionAPI) {
          const recognition = new SpeechRecognitionAPI() as SpeechRecognition;
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'en-US';
          
          // Create a reference to store the recognition object
          const recognitionRef = { current: recognition };
          
          // Function to start recognition with auto-restart on error
          const startRecognition = () => {
            try {
              recognitionRef.current.start();
              setTranscript("Listening...");
              console.log('Speech recognition started');
            } catch (error) {
              console.error('Error starting speech recognition:', error);
              setStatus(`Error starting speech recognition: ${error instanceof Error ? error.message : String(error)}`);
            }
          };
          
          // Start listening
          startRecognition();
          
          // Handle speech recognition results
          recognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
            let interimTranscript = '';
            let finalTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const transcript = event.results[i][0].transcript;
              if (event.results[i].isFinal) {
                finalTranscript += transcript + ' ';
              } else {
                interimTranscript += transcript;
              }
            }
            
            // Update the transcript
            if (finalTranscript) {
              setTranscript(finalTranscript);
              
              // Send the transcript to the GPT API for processing
              setStatus('Processing query...');
              fetch('/api/gpt', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                  query: finalTranscript.trim()
                }),
                // Include credentials to send/receive cookies
                credentials: 'include'
              })
                .then(response => {
                  if (!response.ok) {
                    throw new Error(`API error: ${response.statusText}`);
                  }
                  return response.json();
                })
                .then(data => {
                  console.log('GPT response:', data);
                  const responseText = data.result || 'I processed your request but got no result.';
                  setAiResponse(responseText);
                  setStatus('connected');
                  
                  // Store session ID if provided
                  if (data.sessionId) {
                    setSessionId(data.sessionId);
                  }
                  
                  // Speak the response using the Web Speech API
                  speakResponse(responseText);
                })
                .catch(error => {
                  console.error('Error calling GPT API:', error);
                  const errorMessage = `I encountered an error processing your request: ${error.message}`;
                  setAiResponse(errorMessage);
                  setStatus('connected (with errors)');
                  
                  // Speak the error message
                  speakResponse(errorMessage);
                });
            } else if (interimTranscript) {
              setTranscript(interimTranscript);
            }
          };
          
          // Handle speech recognition end (auto-restart)
          recognitionRef.current.onend = () => {
            console.log('Speech recognition ended, restarting...');
            if (isRecording) {
              // Small delay before restarting to prevent rapid cycling
              setTimeout(() => {
                if (isRecording) {
                  try {
                    startRecognition();
                  } catch (e) {
                    console.error('Failed to restart speech recognition:', e);
                  }
                }
              }, 300);
            }
          };
          
          // Handle errors
          recognitionRef.current.onerror = (event: SpeechRecognitionErrorEvent) => {
            // Only log non-aborted errors as errors
            if (event.error !== 'aborted') {
              console.error('Speech recognition error:', event.error);
              setStatus(`Speech recognition error: ${event.error}`);
            } else {
              // Log aborted errors as info since they're expected during restarts
              console.info('Speech recognition was aborted, this is normal during restarts');
            }
          };
          
          // Clean up on stop
          const handleStopConversation = () => {
            try {
              recognitionRef.current.stop();
              console.log('Speech recognition stopped');
            } catch (e) {
              console.error('Error stopping speech recognition:', e);
            }
          };
          
          // Add event listener for stopping conversation
          document.addEventListener('stopConversation', handleStopConversation, { once: true });
        } else {
          console.warn('Speech Recognition API not supported in this browser');
          setStatus('Speech Recognition not supported in this browser');
        }
        
        // Set remote description from OpenAI
        await peerConnection.setRemoteDescription({
          type: 'answer',
          sdp: sdpAnswer
        });
        
        // Handle incoming audio from AI
        peerConnection.ontrack = (event) => {
          const audioElement = document.createElement("audio");
          audioElement.srcObject = event.streams[0];
          audioElement.autoplay = true;
          document.body.appendChild(audioElement);
        };
        
        setIsConnected(true);
        setStatus("connected");
        setIsRecording(true);
        setTranscript("Listening...");
        
      } catch (apiError) {
        console.error("API error:", apiError);
        setStatus(`API error: ${apiError instanceof Error ? apiError.message : String(apiError)}`);
        setIsConnected(false);
        setIsRecording(false);
      }
      
    } catch (error) {
      console.error("Error starting conversation:", error);
      setStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // Function to stop the conversation
  const stopConversation = () => {
    // Close audio tracks
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    
    // Reset state
    setIsRecording(false);
    setIsConnected(false);
    setStatus("idle");
    setTranscript("");
  };
  
  // Check for existing session cookie on component mount
  useEffect(() => {
    // The session is handled by HTTP cookies, so we don't need to do anything here
    // The backend will automatically use the session cookie for conversation context
    console.log('Component mounted - session will be maintained via cookies');
  }, []);
  
  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, []);
  
  // Initialize conversation when recording starts
  useEffect(() => {
    if (isRecording) {
      // No need to simulate responses anymore as we're using the real API
    }
  }, [isRecording]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-blue-100 p-4">
      <main className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="mb-6 text-center text-3xl font-bold text-blue-600">AI Voice Assistant</h1>
        
        {/* Status display */}
        <div className="mb-4 text-center text-sm text-gray-500">
          Status: {status}
        </div>
        
        {/* Conversation area */}
        <div className="mb-6 h-64 overflow-y-auto rounded-lg bg-gray-50 p-4">
          {transcript && (
            <div className="mb-4">
              <p className="font-medium text-gray-700">You:</p>
              <p className="rounded-lg bg-blue-100 p-2 text-gray-800">{transcript}</p>
            </div>
          )}
          
          {aiResponse && (
            <div className="mb-4">
              <p className="font-medium text-gray-700">AI:</p>
              <p className="rounded-lg bg-green-100 p-2 text-gray-800">{aiResponse}</p>
            </div>
          )}
          
          {!transcript && !aiResponse && (
            <div className="flex h-full items-center justify-center text-gray-400">
              Start a conversation to begin
            </div>
          )}
        </div>
        
        {/* Audio visualization (placeholder) */}
        {isRecording && (
          <div className="mb-6 flex h-12 items-center justify-center space-x-1">
            {[...Array(10)].map((_, i) => (
              <div 
                key={i}
                className="h-full w-2 animate-pulse rounded-full bg-blue-400"
                style={{ 
                  animationDelay: `${i * 0.1}s`,
                  animationDuration: `${0.5 + Math.random() * 0.5}s`
                }}
              />
            ))}
          </div>
        )}
        
        {/* Control buttons */}
        <div className="flex justify-center space-x-4">
          <button
            onClick={isRecording ? stopConversation : startConversation}
            disabled={status === "connecting" || status === "waiting for OpenAI"}
            className={`flex h-16 w-16 items-center justify-center rounded-full ${isRecording 
              ? "bg-red-500 hover:bg-red-600" 
              : "bg-blue-500 hover:bg-blue-600"} 
              text-white shadow-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-300`}
          >
            {isRecording ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <rect x="6" y="6" width="12" height="12" strokeWidth="2" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            )}
          </button>
          
          {/* Reset conversation context button */}
          <button
            onClick={() => {
              // Reset conversation context
              fetch('/api/gpt', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ resetContext: true }),
                credentials: 'include' // Include credentials to send/receive cookies
              })
                .then(response => response.json())
                .then(data => {
                  // Update session ID if provided
                  if (data.sessionId) {
                    setSessionId(data.sessionId);
                  }
                  setAiResponse('Conversation context has been reset.');
                  setTranscript('');
                })
                .catch(error => {
                  console.error('Error resetting context:', error);
                  setAiResponse(`Error resetting context: ${error.message}`);
                });
            }}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-400 hover:bg-gray-500 text-white shadow-lg transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
            title="Reset conversation context"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
        
        {/* Instructions */}
        <p className="mt-6 text-center text-sm text-gray-500">
          {isRecording 
            ? "Click the button to stop recording" 
            : "Click the microphone button to start talking"}
        </p>
      </main>
    </div>
  );
}
