export interface TranscriptionData {
    text: string;          // Transcribed text
    isFinal: boolean;      // Whether this is a final transcription
    language?: string;     // Detected language code
    startTime: number;     // Start time in milliseconds
    endTime: number;       // End time in milliseconds
    speakerId?: string;    // Unique speaker identifier
    duration?: number;     // Duration in milliseconds
  }
  
  export interface HeadPosition {
    position: 'up' | 'down'
    timestamp: number;     // Event timestamp
  }
  
  export interface ButtonPress {
    buttonId: string;      // Identifier for the pressed button
    type: 'single' | 'double'
    timestamp: number;     // Event timestamp
  } 