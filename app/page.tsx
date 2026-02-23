"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import PWAInstallPrompt from "./components/PWAInstallPrompt";
import ServiceWorkerRegistration from "./components/ServiceWorkerRegistration";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  tools?: string[];
  toolResults?: any[];
}

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [status, setStatus] = useState("Ready");
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");
  const [isSendingText, setIsSendingText] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [inputMode, setInputMode] = useState<"voice" | "text">("voice");
  const [isThinking, setIsThinking] = useState(false);
  const [pendingChunks, setPendingChunks] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const pendingChunksRef = useRef<string[]>([]);
  const [audioQueue, setAudioQueue] = useState<string[]>([]);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const isProcessingAudioRef = useRef(false);
  const audioQueueRef = useRef<string[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [audioInitialized, setAudioInitialized] = useState(false);
  const wasRecordingBeforeAudio = useRef(false);
  
  // WebRTC references
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  
  // Function to handle streaming chunks
  const handleStreamingChunks = (chunks: string[], hasMore: boolean) => {
    console.log("🔊 handleStreamingChunks - chunks:", chunks.length, "hasMore:", hasMore);
    if (chunks.length > 1 && hasMore) {
      // Store remaining chunks for later delivery
      const remainingChunks = chunks.slice(1);
      setPendingChunks(remainingChunks);
      pendingChunksRef.current = remainingChunks;
      setIsStreaming(true);
      console.log("🔊 Stored", remainingChunks.length, "pending chunks");
      return chunks[0]; // Return first chunk immediately
    }
    return chunks[0] || ''; // Return single chunk or empty string
  };

  // Function to deliver next chunk
  const deliverNextChunk = () => {
    console.log("🔊 deliverNextChunk - pendingChunksRef:", pendingChunksRef.current.length);
    if (pendingChunksRef.current.length > 0) {
      const nextChunk = pendingChunksRef.current[0];
      const remainingChunks = pendingChunksRef.current.slice(1);
      
      setPendingChunks(remainingChunks);
      pendingChunksRef.current = remainingChunks;
      
      if (remainingChunks.length === 0) {
        setIsStreaming(false);
      }
      
      console.log("🔊 Delivering chunk, remaining:", remainingChunks.length);
      return nextChunk;
    }
    setIsStreaming(false);
    return null;
  };

  // Function to deliver next chunk with audio synchronization
  const deliverNextChunkWithAudio = async () => {
    console.log("🔊 deliverNextChunkWithAudio called, pendingChunksRef:", pendingChunksRef.current.length);
    
    // Wait for current audio to finish before delivering next chunk
    if (isPlayingAudio) {
      console.log("🔊 Waiting for current audio to finish");
      // Poll every 500ms to check if audio finished
      const waitForAudio = () => new Promise<void>((resolve) => {
        const checkAudio = () => {
          if (!isPlayingAudio) {
            console.log("🔊 Audio finished, delivering next chunk");
            resolve();
          } else {
            setTimeout(checkAudio, 500);
          }
        };
        checkAudio();
      });
      
      await waitForAudio();
    }
    
    const nextChunk = deliverNextChunk();
    if (nextChunk) {
      console.log("🔊 Delivering next chunk:", nextChunk.substring(0, 50) + "...");
      addMessage("assistant", nextChunk);
      speakResponse(nextChunk);
      
      // If there are more chunks, schedule the next delivery
      if (pendingChunksRef.current.length > 0) {
        console.log("🔊 Scheduling next chunk delivery, remaining:", pendingChunksRef.current.length);
        setTimeout(() => deliverNextChunkWithAudio(), 500); // Short delay between chunks
      } else {
        console.log("🔊 No more chunks to deliver");
        setIsStreaming(false);
      }
    } else {
      console.log("🔊 No next chunk available");
      setIsStreaming(false);
    }
  };

  // Function to speak the AI response using OpenAI TTS via backend
  const speakResponse = async (text: string) => {
    console.log("🔊 speakResponse called with text:", text.substring(0, 50) + "...");
    
    // Check if we should trigger processing
    const shouldTrigger = audioQueueRef.current.length === 0 && !isPlayingAudio && !isProcessingAudioRef.current;
    console.log("🔊 Current queue length (ref):", audioQueueRef.current.length, "shouldTrigger:", shouldTrigger);
    
    // Add to audio queue (both state and ref)
    const newQueue = [...audioQueueRef.current, text];
    audioQueueRef.current = newQueue;
    setAudioQueue(newQueue);
    console.log("🔊 Audio queue updated, new length:", newQueue.length);
    
    // Trigger processing if this is the first item
    if (shouldTrigger) {
      console.log("🔊 Triggering audio processing immediately");
      setTimeout(() => processAudioQueue(), 50);
    }
  };

  // Function to process audio queue
  const processAudioQueue = async () => {
    console.log("🔊 processAudioQueue called, queue length (ref):", audioQueueRef.current.length, "isPlaying:", isPlayingAudio, "isProcessing:", isProcessingAudioRef.current);
    
    if (isPlayingAudio || audioQueueRef.current.length === 0 || isProcessingAudioRef.current) {
      console.log("🔊 Skipping audio processing");
      return;
    }

    console.log("🔊 Starting audio processing");
    isProcessingAudioRef.current = true;
    setIsPlayingAudio(true);
    
    // Pause speech recognition during audio playback to prevent feedback
    if (recognitionRef.current && isRecording) {
      console.log("🔊 Pausing speech recognition during audio playback");
      wasRecordingBeforeAudio.current = true;
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.log("🔊 Error pausing recognition:", e);
      }
    }
    
    while (audioQueueRef.current.length > 0) {
      const currentText = audioQueueRef.current[0];
      console.log("🔊 Processing audio chunk:", currentText.substring(0, 50) + "...");
      
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: currentText }),
        });

        if (!res.ok) {
          console.warn("🔊 TTS API error:", res.statusText);
          // Remove from queue and continue
          const newQueue = audioQueueRef.current.slice(1);
          audioQueueRef.current = newQueue;
          setAudioQueue(newQueue);
          continue;
        }

        const arrayBuffer = await res.arrayBuffer();
        
        // Use Web Audio API for better iOS compatibility
        if (audioContextRef.current) {
          try {
            const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
            const source = audioContextRef.current.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContextRef.current.destination);
            
            // Wait for audio to finish
            await new Promise<void>((resolve) => {
              source.onended = () => {
                console.log("🔊 Web Audio playback ended");
                resolve();
              };
              
              // Resume AudioContext if suspended (iOS requirement)
              if (audioContextRef.current!.state === 'suspended') {
                audioContextRef.current!.resume().then(() => {
                  source.start(0);
                });
              } else {
                source.start(0);
              }
            });
          } catch (error) {
            console.warn("🔊 Web Audio API error, falling back to Audio element:", error);
            // Fallback to Audio element
            await playWithAudioElement(arrayBuffer);
          }
        } else {
          // Fallback to Audio element if AudioContext not available
          await playWithAudioElement(arrayBuffer);
        }
        
        async function playWithAudioElement(buffer: ArrayBuffer) {
          const blob = new Blob([buffer], { type: 'audio/mpeg' });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          
          // iOS Safari requires these attributes
          audio.setAttribute('playsinline', 'true');
          audio.setAttribute('webkit-playsinline', 'true');
          
          await new Promise<void>((resolve) => {
            const cleanup = () => {
              URL.revokeObjectURL(url);
              console.log("🔊 Audio cleanup completed");
            };
            
            audio.addEventListener('ended', () => {
              cleanup();
              console.log("🔊 Audio playback ended");
              resolve();
            }, { once: true });
            
            audio.addEventListener('error', (error) => {
              cleanup();
              console.warn("🔊 Audio play error:", error);
              resolve();
            }, { once: true });
            
            audio.play().catch(error => {
              console.warn("🔊 Audio play error:", error.message);
              cleanup();
              resolve();
            });
          });
        }
        
        // Remove the processed audio from queue
        const newQueue = audioQueueRef.current.slice(1);
        audioQueueRef.current = newQueue;
        setAudioQueue(newQueue);
        console.log("🔊 Removed chunk from queue, remaining:", newQueue.length);
        
      } catch (error) {
        console.warn("🔊 TTS error:", error instanceof Error ? error.message : String(error));
        // Remove failed audio from queue and continue
        const newQueue = audioQueueRef.current.slice(1);
        audioQueueRef.current = newQueue;
        setAudioQueue(newQueue);
      }
    }
    
    console.log("🔊 Audio processing completed");
    setIsPlayingAudio(false);
    isProcessingAudioRef.current = false;
    
    // Resume speech recognition after audio finishes
    if (wasRecordingBeforeAudio.current && isRecording) {
      console.log("🔊 Resuming speech recognition after audio playback");
      wasRecordingBeforeAudio.current = false;
      
      // Small delay to ensure audio has fully stopped
      setTimeout(() => {
        if (isRecording) {
          try {
            // Try to start existing recognition
            if (recognitionRef.current) {
              recognitionRef.current.start();
              setCurrentTranscript("Listening...");
              console.log("🔊 Speech recognition resumed");
            } else {
              // Recreate recognition if it was destroyed
              console.log("🔊 Recreating speech recognition instance");
              const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
              if (SpeechRecognitionAPI) {
                const newRecognition = new SpeechRecognitionAPI();
                newRecognition.continuous = true;
                newRecognition.interimResults = true;
                newRecognition.lang = 'en-US';
                recognitionRef.current = newRecognition;
                
                // Set up basic handlers (full handlers will be set by startConversation)
                newRecognition.onresult = (event: any) => {
                  let interimTranscript = '';
                  for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                      setCurrentTranscript(transcript);
                    } else {
                      interimTranscript += transcript;
                    }
                  }
                  if (interimTranscript) {
                    setCurrentTranscript(interimTranscript);
                  }
                };
                
                newRecognition.onend = () => {
                  console.log("🎙️ Recognition ended, restarting if still recording");
                  if (isRecording && !wasRecordingBeforeAudio.current) {
                    setTimeout(() => {
                      if (isRecording && recognitionRef.current) {
                        try {
                          recognitionRef.current.start();
                        } catch (e) {
                          console.log("🎙️ Failed to restart:", e);
                        }
                      }
                    }, 100);
                  }
                };
                
                newRecognition.start();
                setCurrentTranscript("Listening...");
                console.log("🔊 New speech recognition instance created and started");
              }
            }
          } catch (e) {
            const error = e as Error;
            // If error is "already started", that's fine
            if (error.message && error.message.includes('already started')) {
              console.log("🔊 Recognition already running, continuing");
              setCurrentTranscript("Listening...");
            } else {
              console.log("🔊 Error resuming recognition:", e);
            }
          }
        }
      }, 300);
    }
  };

  // Initialize AudioContext on first user interaction (iOS requirement)
  const initializeAudio = () => {
    if (!audioContextRef.current) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioContextClass();
        console.log("🔊 AudioContext initialized");
        setAudioInitialized(true);
      } catch (error) {
        console.error("🔊 Failed to initialize AudioContext:", error);
      }
    }
    
    // Resume AudioContext if suspended (iOS requirement)
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().then(() => {
        console.log("🔊 AudioContext resumed from suspended state");
      }).catch(err => {
        console.error("🔊 Failed to resume AudioContext:", err);
      });
    }
  };

  // Cleanup effect to prevent audio loops on unmount
  useEffect(() => {
    return () => {
      isProcessingAudioRef.current = false;
      setAudioQueue([]);
      setIsPlayingAudio(false);
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Add a message to the conversation
  const addMessage = (role: "user" | "assistant", content: string, tools?: string[], toolResults?: any[]) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      role,
      content,
      timestamp: new Date(),
      tools,
      toolResults
    };
    setMessages((prev) => [...prev, newMessage]);
  };

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentTranscript]);

  // Function to handle file upload
  const handleFileUpload = async (file: File) => {
    if (!file) return;
    
    setIsUploading(true);
    setShowUploadMenu(false);
    setStatus("Uploading...");
    
    try {
      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Remove data URL prefix (e.g., "data:image/png;base64,")
          const base64Data = result.split(',')[1];
          resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      
      // Add user message about the upload
      addMessage("user", `📎 Uploading: ${file.name}`);
      
      // Send to API with upload request
      const response = await fetch('/api/gpt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `Upload this file: ${file.name}`,
          streaming: true,
          fileUpload: {
            base64Content: base64,
            fileName: file.name,
            mimeType: file.type,
          }
        }),
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }
      
      const data = await response.json();
      const firstChunk = handleStreamingChunks(data.chunks || [data.result], data.hasMore);
      addMessage("assistant", firstChunk, data.toolsUsed || [], data.toolResults || []);
      setStatus('Connected');
      
      if (data.sessionId) {
        setSessionId(data.sessionId);
      }
      
      speakResponse(firstChunk);
    } catch (error) {
      const errorMessage = `Upload failed: ${error instanceof Error ? error.message : String(error)}`;
      addMessage("assistant", errorMessage);
      setStatus('Error');
    } finally {
      setIsUploading(false);
    }
  };
  
  // Handle file input change
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  // Function to send a typed text message to the assistant
  const sendTextMessage = async () => {
    const query = textInput.trim();
    if (!query) return;

    // Initialize audio on first interaction (iOS requirement)
    initializeAudio();

    addMessage("user", query);
    setIsSendingText(true);
    setIsThinking(true);
    setStatus("Processing...");
    setCurrentTranscript("");

    try {
      const response = await fetch('/api/gpt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          query,
          streaming: true 
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      console.log("📦 API Response:", data);
      console.log("🔧 Tool Results:", data.toolResults);
      
      // Handle streaming chunks
      const firstChunk = handleStreamingChunks(data.chunks || [data.result], data.hasMore);
      console.log("🔊 Text mode - firstChunk:", firstChunk, "hasMore:", data.hasMore, "chunks:", data.chunks?.length);

      addMessage("assistant", firstChunk, data.toolsUsed || [], data.toolResults || []);
      setStatus('Connected');

      if (data.sessionId) {
        setSessionId(data.sessionId);
      }

      speakResponse(firstChunk);
      setTextInput("");
      
      // Set up automatic delivery of remaining chunks with audio synchronization
      if (data.hasMore && data.chunks && data.chunks.length > 1) {
        console.log("🔊 Text mode - setting up chunk delivery for", data.chunks.length - 1, "more chunks");
        // Start delivering chunks after first audio begins
        setTimeout(() => deliverNextChunkWithAudio(), 1000); // Wait for first chunk audio to start
      } else {
        console.log("🔊 Text mode - no more chunks to deliver");
      }
    } catch (error) {
      const errorMessage = `I encountered an error processing your request: ${
        error instanceof Error ? error.message : String(error)
      }`;
      addMessage("assistant", errorMessage);
      setStatus('Error');
      speakResponse(errorMessage);
    } finally {
      setIsSendingText(false);
      setIsThinking(false);
    }
  };
  
  // Function to start the conversation
  const startConversation = async () => {
    console.log("🎤 Starting voice conversation...");
    
    // Check if running in browser environment
    if (typeof window === 'undefined') {
      console.error("🎤 Voice mode not available in server environment");
      setStatus('Voice mode requires browser environment');
      return;
    }
    
    // Check browser support for speech recognition
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      console.error("🎤 Speech recognition not supported");
      setStatus('Speech recognition not supported. Please use Chrome or Edge browser.');
      // Auto-switch to text mode
      setInputMode("text");
      return;
    }
    
    try {
      setStatus("Connecting...");
      setIsRecording(true);
      
      // Create new recognition instance
      const recognition = new SpeechRecognitionAPI();
      recognitionRef.current = recognition;
      
      console.log("🎤 Recognition instance created");
      
      // Configure recognition
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      
      // Handle results
      recognition.onresult = (event: any) => {
        console.log("🎤 Got speech result");
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
        
        if (finalTranscript) {
          const cleanTranscript = finalTranscript.trim();
          console.log("🎤 Final transcript:", cleanTranscript);
          addMessage("user", cleanTranscript);
          setCurrentTranscript("");
          setIsThinking(true);
          setStatus("Processing...");
          
          // Send to GPT API
          fetch('/api/gpt', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query: cleanTranscript,
              streaming: true,
            }),
            credentials: 'include'
          })
            .then(response => {
              if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
              }
              return response.json();
            })
            .then(data => {
              // Handle streaming chunks
              const firstChunk = handleStreamingChunks(data.chunks || [data.result], data.hasMore);
              console.log("🔊 Voice mode - firstChunk:", firstChunk, "hasMore:", data.hasMore, "chunks:", data.chunks?.length);
              
              addMessage("assistant", firstChunk, data.toolsUsed || []);
              setStatus('Connected');

              if (data.sessionId) {
                setSessionId(data.sessionId);
              }

              speakResponse(firstChunk);
              
              // Set up automatic delivery of remaining chunks with audio synchronization
              if (data.hasMore && data.chunks && data.chunks.length > 1) {
                console.log("🔊 Voice mode - setting up chunk delivery for", data.chunks.length - 1, "more chunks");
                // Start delivering chunks after first audio begins
                setTimeout(() => deliverNextChunkWithAudio(), 1000); // Wait for first chunk audio to start
              } else {
                console.log("🔊 Voice mode - no more chunks to deliver");
              }
            })
            .catch(error => {
              const errorMessage = `I encountered an error processing your request: ${error.message}`;
              addMessage("assistant", errorMessage);
              setStatus('Error');
              speakResponse(errorMessage);
            })
            .finally(() => {
              setIsThinking(false);
            });
        } else if (interimTranscript) {
          setCurrentTranscript(interimTranscript);
        }
      };
      
      // Handle errors
      recognition.onerror = (event: any) => {
        console.error("🎤 Speech recognition error:", event.error);
        
        // Don't show errors if we're intentionally stopping
        if (isStopping) {
          console.log("🎤 Ignoring error during intentional stop");
          return;
        }
        
        // Handle common errors gracefully
        if (event.error === 'aborted') {
          console.log("🎤 Recognition aborted, will restart if still recording");
          // Don't set status to error for aborted - it's normal
          setTimeout(() => {
            if (isRecording && recognitionRef.current && !isStopping) {
              try {
                recognitionRef.current.start();
                console.log("🎤 Restarted recognition after abort");
              } catch (e) {
                console.error("🎤 Failed to restart after abort:", e);
                setStatus('Microphone access required. Please allow microphone access.');
                setIsRecording(false);
              }
            }
          }, 500);
        } else if (event.error === 'not-allowed') {
          setStatus('Microphone permission denied. Please allow microphone access and refresh.');
          setIsRecording(false);
        } else if (event.error === 'network') {
          setStatus('Network error. Please check your internet connection.');
          setIsRecording(false);
        } else {
          setStatus(`Speech recognition error: ${event.error}`);
          setIsRecording(false);
        }
      };
      
      // Handle end
      recognition.onend = () => {
        console.log("🎤 Speech recognition ended");
        // Don't restart if we're pausing for audio playback
        if (isRecording && !isStopping && !wasRecordingBeforeAudio.current) {
          // Restart if still in recording mode and not intentionally stopping
          setTimeout(() => {
            if (isRecording && recognitionRef.current && !isStopping && !wasRecordingBeforeAudio.current) {
              try {
                recognitionRef.current.start();
                console.log("🎤 Restarted recognition");
              } catch (e) {
                console.error("🎤 Failed to restart recognition:", e);
                // Try to create a new recognition instance
                try {
                  const newRecognition = new SpeechRecognitionAPI();
                  newRecognition.continuous = true;
                  newRecognition.interimResults = true;
                  newRecognition.lang = 'en-US';
                  
                  // Copy event handlers
                  newRecognition.onresult = recognition.onresult;
                  newRecognition.onerror = recognition.onerror;
                  newRecognition.onend = recognition.onend;
                  
                  recognitionRef.current = newRecognition;
                  newRecognition.start();
                  console.log("🎤 Created new recognition instance and restarted");
                } catch (e2) {
                  console.error("🎤 Failed to create new recognition:", e2);
                  setStatus('Microphone access required. Please allow microphone access.');
                  setIsRecording(false);
                }
              }
            }
          }, 100);
        }
      };
      
      // Start recognition
      try {
        recognition.start();
        setStatus("Connected");
        setCurrentTranscript("Listening...");
        console.log("🎤 Speech recognition started successfully");
      } catch (error) {
        console.error("🎤 Failed to start recognition:", error);
        setStatus(`Failed to start: ${error instanceof Error ? error.message : String(error)}`);
        setIsRecording(false);
      }
      
    } catch (error) {
      console.error("🎤 Error starting conversation:", error);
      setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
      setIsRecording(false);
    }
  };
  
  const stopConversation = () => {
    console.log("🎤 Stopping conversation...");
    setIsStopping(true);
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
        recognitionRef.current = null;
        console.log("🎤 Recognition stopped");
      } catch (e) {
        console.log("🎤 Error stopping recognition (expected):", e);
      }
    }
    
    setIsRecording(false);
    setIsStopping(false);
    setIsConnected(false);
    setStatus("Ready");
    setCurrentTranscript("");
  };

  const resetConversation = () => {
    fetch('/api/gpt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ resetContext: true }),
      credentials: 'include'
    })
      .then(response => response.json())
      .then(data => {
        if (data.sessionId) {
          setSessionId(data.sessionId);
        }
        setMessages([]);
        addMessage("assistant", "Conversation context has been reset.");
      })
      .catch(error => {
        addMessage("assistant", `Error resetting context: ${error.message}`);
      });
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, []);

  return (
    <div className="flex h-screen bg-[#0a0e1a] text-[#e0e6ed] overflow-hidden">
      {/* Main Chat Area - Full Screen */}
      <div className="flex-1 flex flex-col">
        {/* Minimal Header */}
        <header className="bg-[#1a1f2e] border-b border-[#2d3748] px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <h1 className="text-lg font-bold text-white">Flight Deck Assistant</h1>
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-400" : "bg-yellow-400"}`}></div>
                <span className="text-xs text-[#a0aec0]">{status}</span>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={resetConversation}
                className="p-2 bg-[#2d3748] hover:bg-[#4a5568] rounded-lg transition-colors"
                title="Clear Conversation"
              >
                🗑️
              </button>
            </div>
          </div>
        </header>

        {/* Messages Area - Full Height */}
        <main 
          className="flex-1 overflow-y-auto p-4"
          onClick={() => {
            // Resume AudioContext on tap (iOS requirement)
            if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
              audioContextRef.current.resume().then(() => {
                console.log("🔊 AudioContext resumed by tap");
              });
            }
          }}
        >
          {messages.length === 0 && !isRecording && !currentTranscript ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <svg className="w-12 h-12 mb-4 text-[#4a5568]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <h2 className="text-xl font-semibold text-white mb-2">Aviation AI Assistant</h2>
              <p className="text-[#a0aec0] mb-6 max-w-md">Ready to help with flight planning, weather, NOTAMs, routes, and more.</p>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`max-w-2xl ${
                    message.role === "user" 
                      ? "bg-[#2d3748]" 
                      : "bg-[#1a365d]"
                  } rounded-lg px-4 py-3`}>
                    <div className="flex items-start space-x-2">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                        message.role === "user" ? "bg-[#4a5568]" : "bg-[#00d4ff]"
                      }`}>
                        {message.role === "user" ? (
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm text-white break-words">
                          <ReactMarkdown
                            components={{
                              // Style links to be clickable and visible
                              a: ({href, children}) => (
                                <a 
                                  href={href} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-blue-400 hover:text-blue-300 underline"
                                >
                                  {children}
                                </a>
                              ),
                              // Style paragraphs
                              p: ({children}) => <p className="mb-2">{children}</p>,
                              // Style code blocks
                              code: ({children}) => <code className="bg-gray-700 px-1 rounded">{children}</code>
                            }}
                          >
                            {message.content}
                          </ReactMarkdown>
                        </div>
                        {message.tools && message.tools.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {message.tools.map((tool, index) => (
                              <span key={index} className="inline-flex items-center px-2 py-1 rounded text-xs bg-[#2d3748] text-[#ffa500]">
                                🔧 {tool}
                              </span>
                            ))}
                          </div>
                        )}
                        {message.toolResults && message.toolResults.some(tr => tr.toolName === 'create_document' && tr.result?.data?.link) && (
                          <div className="mt-3 p-3 bg-[#2d3748] rounded-lg border border-[#4a5568]">
                            {message.toolResults.filter(tr => tr.toolName === 'create_document' && tr.result?.data?.link).map((tr, idx) => (
                              <a 
                                key={idx}
                                href={tr.result.data.link} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 text-blue-400 hover:text-blue-300 hover:underline"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <span>📄 Download PDF</span>
                              </a>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-[#a0aec0] mt-1">
                          {message.timestamp.toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              
              {currentTranscript && (
                <div className="flex justify-start">
                  <div className="bg-[#2d3748] rounded-lg px-4 py-3 opacity-75">
                    <div className="flex items-start space-x-2">
                      <div className="w-6 h-6 rounded-full bg-[#4a5568] flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                      <p className="text-sm text-[#e0e6ed] italic">{currentTranscript}</p>
                    </div>
                  </div>
                </div>
              )}
              
              {isThinking && (
                <div className="flex justify-start">
                  <div className="bg-[#1a365d] rounded-lg px-4 py-3">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 rounded-full bg-[#00d4ff] flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-[#00d4ff] rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-[#00d4ff] rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-[#00d4ff] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {isRecording && (
                <div className="flex justify-center">
                  <div className="text-center">
                    <div className="mb-4">
                      <div className="inline-flex items-center justify-center w-16 h-16 bg-[#00d4ff] rounded-full animate-pulse">
                        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                      </div>
                    </div>
                    
                    {/* Audio Visualization */}
                    <div className="mb-4 flex items-center justify-center space-x-1">
                      {[...Array(8)].map((_, i) => (
                        <div 
                          key={i}
                          className="w-1 bg-[#00d4ff] rounded-full animate-pulse"
                          style={{ 
                            height: `${16 + Math.random() * 24}px`,
                            animationDelay: `${i * 0.05}s`,
                            animationDuration: `${0.5 + Math.random() * 0.5}s`
                          }}
                        />
                      ))}
                    </div>
                    
                    <p className="text-xs text-[#a0aec0]">Listening...</p>
                  </div>
                </div>
              )}

              {/* Voice Mode Instructions - When not recording */}
              {!isRecording && inputMode === "voice" && messages.length === 0 && (
                <div className="flex justify-center">
                  <div className="text-center max-w-md">
                    <div className="mb-6">
                      <div className="inline-flex items-center justify-center w-20 h-20 bg-[#2d3748] rounded-full border-2 border-dashed border-[#00d4ff]">
                        <svg className="w-10 h-10 text-[#00d4ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                      </div>
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2">Voice Mode Active</h3>
                    <p className="text-[#a0aec0] mb-4">Click the microphone button below to start speaking with your aviation assistant</p>
                    <div className="flex items-center justify-center space-x-2 text-xs text-[#4a5568]">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13l-3 3m0 0l-3-3m3 3V8m0 13a9 9 0 110-18 9 9 0 010 18z" />
                      </svg>
                      <span>Click microphone to begin</span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          )}
        </main>

        {/* Compact Input Bar */}
        <div className="bg-[#1a1f2e] border-t border-[#2d3748] p-3">
          <div className="flex items-center justify-center space-x-4">
            {/* Mode Toggle */}
            <div className="flex items-center bg-[#2d3748] rounded-lg p-1">
              <button
                onClick={() => setInputMode("voice")}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  inputMode === "voice" 
                    ? "bg-[#00d4ff] text-white" 
                    : "text-[#a0aec0] hover:text-white"
                }`}
              >
                🎤 Voice
              </button>
              <button
                onClick={() => setInputMode("text")}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  inputMode === "text" 
                    ? "bg-[#00d4ff] text-white" 
                    : "text-[#a0aec0] hover:text-white"
                }`}
              >
                ⌨️ Text
              </button>
            </div>

            {/* Input Controls */}
            {inputMode === "voice" ? (
              <button
                onClick={() => {
                  console.log("🎤 Microphone button clicked!");
                  console.log("🎤 Current status:", status);
                  console.log("🎤 Is recording:", isRecording);
                  
                  // Initialize audio on first interaction (iOS requirement)
                  initializeAudio();
                  
                  if (isRecording) {
                    stopConversation();
                  } else {
                    startConversation();
                  }
                }}
                disabled={status === "Connecting..." || status === "Establishing connection..."}
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  backgroundColor: isRecording ? "#ef4444" : "#00d4ff",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: status === "Connecting..." || status === "Establishing connection..." ? "not-allowed" : "pointer",
                  opacity: status === "Connecting..." || status === "Establishing connection..." ? 0.5 : 1,
                  transition: "all 0.2s",
                  boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)"
                }}
                onMouseEnter={(e) => {
                  if (!isRecording && status !== "Connecting..." && status !== "Establishing connection...") {
                    e.currentTarget.style.backgroundColor = "#00b8e6";
                    e.currentTarget.style.transform = "scale(1.05)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isRecording && status !== "Connecting..." && status !== "Establishing connection...") {
                    e.currentTarget.style.backgroundColor = "#00d4ff";
                    e.currentTarget.style.transform = "scale(1)";
                  }
                }}
              >
                {isRecording ? (
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" strokeWidth="2" />
                  </svg>
                ) : (
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}
              </button>
            ) : (
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full max-w-2xl px-2 sm:px-0">
                {/* Hidden file inputs */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf,.doc,.docx,.txt"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
                
                {/* Upload button with dropdown */}
                <div className="relative flex-shrink-0">
                  <button
                    onClick={() => setShowUploadMenu(!showUploadMenu)}
                    disabled={isUploading}
                    className="p-2 sm:p-3 bg-[#2d3748] hover:bg-[#4a5568] text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-[#4a5568]"
                    title="Upload file"
                  >
                    {isUploading ? (
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                    )}
                  </button>
                  
                  {/* Upload menu dropdown */}
                  {showUploadMenu && (
                    <div className="absolute bottom-full left-0 mb-2 bg-[#2d3748] border border-[#4a5568] rounded-lg shadow-lg overflow-hidden min-w-[160px]">
                      <button
                        onClick={() => {
                          cameraInputRef.current?.click();
                          setShowUploadMenu(false);
                        }}
                        className="w-full px-4 py-3 text-left text-sm text-white hover:bg-[#4a5568] flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Take Photo
                      </button>
                      <button
                        onClick={() => {
                          fileInputRef.current?.click();
                          setShowUploadMenu(false);
                        }}
                        className="w-full px-4 py-3 text-left text-sm text-white hover:bg-[#4a5568] flex items-center gap-2 border-t border-[#4a5568]"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Choose File
                      </button>
                    </div>
                  )}
                </div>
                
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      sendTextMessage();
                    }
                  }}
                  className="w-full sm:flex-1 sm:w-auto min-w-0 bg-[#2d3748] border border-[#4a5568] rounded-lg px-3 sm:px-4 py-3 text-sm text-white placeholder-[#a0aec0] focus:outline-none focus:ring-2 focus:ring-[#00d4ff] focus:border-transparent order-last sm:order-none"
                  placeholder="Ask anything..."
                />
                <button
                  onClick={sendTextMessage}
                  disabled={isSendingText || !textInput.trim()}
                  className="px-4 sm:px-6 py-3 bg-[#00d4ff] hover:bg-[#00b8e6] text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 order-last sm:order-none"
                >
                  {isSendingText ? "..." : "Send"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* PWA Components */}
      <ServiceWorkerRegistration />
      <PWAInstallPrompt />
    </div>
  );
}
