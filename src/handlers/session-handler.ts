import {TpaSession} from '@augmentos/sdk';
import {setTimeout as sleep} from 'timers/promises';
import logger from '../utils/logger'
import {DeviceInfo, SessionState} from '../types'
import {tokenService} from '../services/token-service';
import {spotifyService} from '../services/spotify-service';
import {shazamService} from '../services/shazam-service';
import { stat } from 'fs';

// Player command actions
export enum PlayerCommand {
  CURRENT = 'current',
  NEXT = 'next',
  BACK = 'back',
  PLAY = 'play',
  PAUSE = 'pause',
  TRIGGER_SHAZAM = 'trigger_shazam',
  TRIGGER_DEVICE_LIST = 'trigger_device_list'
}

// Different modes for sessions
export enum SessionMode {
  IDLE,
  LISTENING_FOR_SHAZAM,
  AWAITING_DEVICE_SELECTION
}

// Map for holding states of the session
const sessionStates = new Map<string, SessionState>();
// Maps for voice commands
const playerCommandMappings = {
  [PlayerCommand.CURRENT]: ['current.', 'what\'s playing', 'now playing', 'current song'],
  [PlayerCommand.NEXT]: ['next.', 'next song', 'skip song'],
  [PlayerCommand.BACK]: ['back.', 'previous.', 'previous song'],
  [PlayerCommand.PLAY]: ['play.', 'play music', 'play song'],
  [PlayerCommand.PAUSE]: ['pause.', 'pause music', 'pause song']
};
const triggerPhases = {
  [PlayerCommand.TRIGGER_SHAZAM]: ['shazam', 'find song', 'what song is this', 'identify song'],
}

// Set up session event handlers
export function setupSessionHandlers(session: TpaSession, sessionId: string, settings: any): Array<() => void> {
  // Array for handler cleanup
  const cleanupHandlers: Array<() => void> = [];
  logger.debug(settings);

  // Initialize base sessionState to idle
  sessionStates.set(sessionId, {mode: SessionMode.IDLE, timeoutId: null});
  logger.info(`[Session ${sessionId}] Initialized session state to IDLE.`, {
    sessionId: sessionId,
    settings: settings
  });

  // Check if voice commands are enabled from settings
  if (settings.isVoiceCommands?.value) {
    // Listen for user command via transcription
    const transcriptionHandler = session.events.onTranscription(async (data) => {
      logger.debug(`[Session ${sessionId}] Received transcription data.`, {
        isFinal: data.isFinal, 
        textLength: data.text?.length, 
        sessionId: sessionId 
      });
      if (!data.isFinal) return;
      const lowerText = data.text.toLowerCase().trim()
      if (lowerText === '') return;
      const currentState = getSessionState(sessionId);
      logger.debug(`[Session ${sessionId}] Processing final transcript in mode: ${SessionMode[currentState.mode]}`, { transcript: lowerText, state: currentState, sessionId: sessionId });

      // Switch case for mode of current state
      switch (currentState.mode) {
        case SessionMode.IDLE:
          // Loops through trigger phases to change states
          for (const [trigger, phases] of Object.entries(triggerPhases)) {
            for (const phrase of phases) {
              if (lowerText.includes(phrase)) {

                // Switch statement for trigger commands
                switch (trigger as PlayerCommand) {
                  case PlayerCommand.TRIGGER_SHAZAM:
                    await triggerShazam(session, sessionId);
                    break;

                }
                return;
              }
            }
          }
        
          // Loops through each phrase in 
          for (const [command, phrases] of Object.entries(playerCommandMappings)) {
            for (const phrase of phrases) {
              if (lowerText.includes(phrase)) {
                await handlePlayerCommand(session, sessionId, command as PlayerCommand);
                return;
              }
            }
          }

          break;

        case SessionMode.LISTENING_FOR_SHAZAM:
          await handleShazamInput(session, sessionId, data.text);
          break;

        default:
          logger.warn(`[Session ${sessionId}] Unhandled session mode: ${currentState.mode}`, {
            sessionId: sessionId,
            userId: sessionId,
            modeValue: currentState.mode
          });
          setSessionMode(session, sessionId, SessionMode.IDLE);
      }
    });

    cleanupHandlers.push(transcriptionHandler);
  }

  // Check if heads up display is enabled from settings
  if (settings.isHeadsUpDisplay.value) {
    // Head position events
    const headPositionHandler = session.events.onHeadPosition(async (data) => {
      if (data.position === 'up') {
        const currentState = getSessionState(sessionId);

        if (currentState.mode === SessionMode.IDLE) {
          await handlePlayerCommand(session, sessionId, PlayerCommand.CURRENT);
        }
      }
    });

    cleanupHandlers.push(headPositionHandler);
  }

  // Error handler
  const errorHandler = session.events.onError((error) => {
    logger.error(`Error`, {
      sessionId: sessionId,
      settings: settings,
      error: {
        message: error.message,
        stack: error.stack,
        responseStatus: error.response?.status,
        responseBody: error.response?.data 
      }
    });
    session.layouts.showTextWall(`Error: ${error.message}`);
  });

  // Add handlers to the cleanup array
  cleanupHandlers.push(errorHandler);

  const stateCleanup = () => {
    const state = sessionStates.get(sessionId);
    if (state?.timeoutId) {
      clearTimeout(state.timeoutId);
    }
    sessionStates.delete(sessionId);
    logger.info(`[Session ${sessionId}] Cleaned up session state.`, {
      sessionId: sessionId 
    });
  };

  cleanupHandlers.push(stateCleanup);
  
  // Return all cleanup handlers
  return cleanupHandlers;
}

// Handle player commands
async function handlePlayerCommand(session: TpaSession, sessionId: string, command: PlayerCommand): Promise<void> {
  // Check if user is authenticated
  if (!tokenService.hasToken(sessionId)) {
    session.layouts.showTextWall('Please connect your Spotify account first.', {durationMs: 5000});
    return;
  }

  // Refresh token if needed
  const tokenValid = await spotifyService.refreshTokenIfNeeded(sessionId);
  if (!tokenValid) {
    session.layouts.showTextWall('Error refreshing Spotify connection. Please reconnect your account.', {durationMs: 5000});
    return;
  }

  try {
    switch (command) {
      case PlayerCommand.CURRENT:
        await displayCurrentlyPlaying(session, sessionId);
        break;

      case PlayerCommand.NEXT:
        await spotifyService.nextTrack(sessionId);
        await displayCurrentlyPlaying(session, sessionId);
        break;
      
      case PlayerCommand.BACK:
        await spotifyService.previousTrack(sessionId);
        await displayCurrentlyPlaying(session, sessionId);
        break;
      
      case PlayerCommand.PLAY:
        try {
          await spotifyService.playTrack(sessionId);
          await displayCurrentlyPlaying(session, sessionId);
        } catch (error) {
          logger.error(`Music play error`, {
            sessionId: sessionId,
            command: command,
            error: {
              message: error.message,
              stack: error.stack,
              responseStatus: error.response?.status,
              responseBody: error.response?.data 
            }
          });
          session.layouts.showTextWall('Error playing music.', {durationMs: 5000});
        }
        break;

      case PlayerCommand.PAUSE:
        try {
          await spotifyService.pauseTrack(sessionId);
          await displayCurrentlyPlaying(session, sessionId);
        } catch (error) {
          logger.error(`Music pause error`, {
            sessionId: sessionId,
            command: command,
            error: {
              message: error.message,
              stack: error.stack,
              responseStatus: error.response?.status,
              responseBody: error.response?.data 
            }
          });
          session.layouts.showTextWall('Error pausing music.', {durationMs: 5000});
        }
        break;

      default:
        logger.warn(`Unhandled player command: ${command}`, {
          sessionId: sessionId,
          command: command
        });
        break;
    }
  } catch (error){
    logger.error(`Spotify API error during command ${command}`, {
      sessionId: sessionId,
      command: command,
      error: {
        message: error.message,
        stack: error.stack,
        responseStatus: error.response?.status,
        responseBody: error.response?.data 
      }
    });
    let userMessage = 'Error executing command. Please try again.';

    if (error.response?.data?.error?.message) { 
      userMessage = `Spotify Error: ${error.response.data.error.message}`;
    }
    else if (error.message?.includes('NO_ACTIVE_DEVICE')) { 
      userMessage = 'No active Spotify device found.';
    }
    session.layouts.showTextWall(userMessage, {durationMs: 5000});
  }
}

// Display the currently playing track
export async function displayCurrentlyPlaying(session: TpaSession, sessionId: string): Promise<void> {
  try {
    const tokenValid = await spotifyService.refreshTokenIfNeeded(sessionId);
    if (!tokenValid) {
      session.layouts.showTextWall('Error with spotify authentication. Please reconnect your account.');
      return;
    }

    // Sleep to give time for spotify to update currently playing
    await sleep(500)
    const playbackInfo = await spotifyService.getCurrentlyPlaying(sessionId);
    logger.debug(`[Session ${sessionId}] Fetched playback info from Spotify.`, {
      playbackInfo: playbackInfo,
      sessionId: sessionId
    });
    
    // Ceck for the required info
    if (playbackInfo && playbackInfo.trackName) {
      const displayText = 
        `${playbackInfo.isPlaying ? 'Now Playing' : 'Paused'}\n\n` +
        `Song: ${playbackInfo.trackName}\n` +
        `Artist: ${playbackInfo.artists}\n` +
        (playbackInfo.albumName ? `Album: ${playbackInfo.albumName}` : '');
      
      // Display the now playing information
      session.layouts.showTextWall(displayText, {durationMs: 5000});
    } else {
      // Nothing is playing
      session.layouts.showTextWall('No track currently playing on Spotify', {durationMs: 5000});
    }
  } catch (error) {
    logger.error(`Error displaying current track`, {
      sessionId: sessionId,
      error: {
        message: error.message,
        stack: error.stack,
        responseStatus: error.response?.status,
        responseBody: error.response?.data 
      }
    });
    session.layouts.showTextWall('Error getting track information', {durationMs: 5000});
  }
}

function getSessionState(sessionId: string): SessionState {
  // Check for sessionState
  if (!sessionStates.has(sessionId)) {
    logger.warn(`[Session ${sessionId}] State not found, initializing to IDLE.`, {
      sessionId: sessionId
    });
    // Initialize default if no
    sessionStates.set(sessionId, {mode: SessionMode.IDLE, timeoutId: null});
  }

  // Return sessionState for sessionId
  return sessionStates.get(sessionId)!;
}

function setSessionMode(session: TpaSession, sessionId: string, newMode: SessionMode, options?: {data?: any; timeoutMs?: number; timeoutMessage?: string}): void {
  const currentState = getSessionState(sessionId);

  if (currentState.timeoutId) {
    // Clear timeout to set new one
    clearTimeout(currentState.timeoutId);
  }

  let newTimeoutId: NodeJS.Timeout | null = null;
  if (options?.timeoutMs) {
    newTimeoutId = setTimeout(() => {
      logger.info(`[Session ${sessionId}] Timeout reached for mode ${SessionMode[newMode]}. Resetting to IDLE.`, {
        sessionId: sessionId,
        newMode: SessionMode[newMode]
      })
      const timedOutState = sessionStates.get(sessionId);
      if (timedOutState && timedOutState.mode === newMode) {
        // Reset session to IDLE on timeout spread(...) old state for futureproofing
        sessionStates.set(sessionId, {...timedOutState, mode: SessionMode.IDLE, timeoutId: null, data: undefined});
        session.layouts.showTextWall(options.timeoutMessage || 'Action timed out.', {durationMs: 5000});
      }
    }, options.timeoutMs);
  }

  // Set new state with provided parameters
  const newState: SessionState = {
    mode: newMode,
    timeoutId: newTimeoutId,
    data: options?.data,
  };

  sessionStates.set(sessionId, newState);
  logger.info(`[Session ${sessionId}] Mode changed to ${SessionMode[newMode]}`, {
    newMode: SessionMode[newMode],
    sessionId: sessionId,
    hasData: options?.data !== undefined,
    timeoutSet: options?.timeoutMs !== undefined,
  });
}

async function triggerShazam(session: TpaSession, sessionId: string): Promise<void> {
  logger.info(`[Session ${sessionId}] Triggering shazam listening mode.`, {
    sessionId: sessionId
  });
  await enterShazamMode(session, sessionId);
}

async function enterShazamMode(session: TpaSession, sessionId: string): Promise<void> {
  session.layouts.showTextWall('Listening for song...', {durationMs: 10000 - 500});
  // Update session mode to LISTENING_FOR_SHAZAM
  setSessionMode(session, sessionId, SessionMode.LISTENING_FOR_SHAZAM, {
    timeoutMs: 10000,
    timeoutMessage: 'Shazam cancelled. No speech detected.'
  });
}

async function handleShazamInput(session: TpaSession, sessionId: string, transcript: string): Promise<void> {
  logger.info(`[Session ${sessionId}] Processing Shazam input: "${transcript}"`, {
    sessionId: sessionId,
    transcript: transcript
  });
  setSessionMode(session, sessionId, SessionMode.IDLE);

  if (!transcript || transcript.trim().length === 0) {
    logger.info(`[Session ${sessionId}] Empty transcript received for Shazam.`, {
      sessionId: sessionId
    });
    session.layouts.showTextWall('Could not identify song (no speech).', {durationMs: 5000});
    return;
  }

  try {
    session.layouts.showTextWall(`Searching Shazam for: "${transcript.substring(0, 30)}${transcript.length > 30 ? '...' : ''}"`, {durationMs: 5000});
    const songInfo = await shazamService.findTrack(transcript);

    if (songInfo.trackName) {
      const displayText = 
        `Found song:\n\n` + 
        `Song: ${songInfo.trackName}\n` + 
        `Artist: ${songInfo.artist}`;
      session.layouts.showTextWall(displayText, {durationMs: 5000});
    } else {
      session.layouts.showTextWall(`Could not identify song for "${transcript.substring(0, 30)}${transcript.length > 30 ? '...' : ''}"`, {durationMs: 5000});
    }
  } catch (error) {
    logger.error(`[Session ${sessionId}] Shazam service error`, {
      sessionId: sessionId,
      transcript: transcript,
      error: {
        message: error.message,
        stack: error.stack,
        responseStatus: error.response?.status,
        responseBody: error.response?.data 
      }
    });
    session.layouts.showTextWall('Error identifying song via Shazam.', {durationMs: 5000});
  }
}