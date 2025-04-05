import {TpaSession} from '@augmentos/sdk';
import {spotifyService} from '../services/spotify-service';
import {tokenService} from '../services/token-service';
import {setTimeout as sleep} from 'timers/promises';
import {DeviceInfo, SessionState} from '../types'
import {shazamService} from '../services/shazam-service';

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

export enum SessionMode {
  IDLE,
  LISTENING_FOR_SHAZAM,
  AWAITING_DEVICE_SELECTION
}

const sessionStates = new Map<string, SessionState>()
const playerCommandMappings = {
  [PlayerCommand.CURRENT]: ['current.', 'what\'s playing', 'now playing', 'current song'],
  [PlayerCommand.NEXT]: ['next.', 'next song', 'skip song'],
  [PlayerCommand.BACK]: ['back.', 'previous.', 'previous song'],
  [PlayerCommand.PLAY]: ['play.', 'play music', 'play song'],
  [PlayerCommand.PAUSE]: ['pause.', 'pause music', 'pause song']
};
const triggerPhases = {
  [PlayerCommand.TRIGGER_SHAZAM]: ['shazam', 'find song', 'what song is this', 'identify song'],
  [PlayerCommand.TRIGGER_DEVICE_LIST]: ['show devices', 'list devices', 'change device', 'select device']
}

// Set up session event handlers
export function setupSessionHandlers(session: TpaSession, sessionId: string, settings: any): Array<() => void> {
  const cleanupHandlers: Array<() => void> = [];
  // console.log(settings);

  sessionStates.set(sessionId, {mode: SessionMode.IDLE, timeoutId: null});
  console.log(`[Session ${sessionId}] Initialized session state to IDLE.`);

  // Listen for user command via transcription
  if (settings.isVoiceCommands?.value) {
    const transcriptionHandler = session.events.onTranscription(async (data) => {
      if (!data.isFinal) return;
      const lowerText = data.text.toLowerCase().trim()
      if (lowerText === '') return;
      const currentState = getSessionState(sessionId);

      switch (currentState.mode) {
        case SessionMode.IDLE:
          for (const [trigger, phases] of Object.entries(triggerPhases)) {
            for (const phrase of phases) {
              if (lowerText.includes(phrase)) {

                switch (trigger as PlayerCommand) {
                  case PlayerCommand.TRIGGER_SHAZAM:
                    await triggerShazam(session, sessionId);
                    break;

                  // case PlayerCommand.TRIGGER_DEVICE_LIST:
                  //   await triggerDeviceList(session, sessionId);
                  //   break;
                }
                return;
              }
            }
          }
        
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

        // case SessionMode.AWAITING_DEVICE_SELECTION:
        //   if (currentState.data && Array.isArray(currentState.data)) {
        //     await handleDeviceSelectionInput(session, sessionId, lowerText, currentState.data as DeviceInfo[]);
        //   } else {
        //     console.error(`[Session ${sessionId}] Missing device data in AWAITING_DEVICE_SELECTION mode.`);
        //     session.layouts.showTextWall('Internal error: Device list missing.', {durationMs: 5000});
        //     setSessionMode(session, sessionId, SessionMode.IDLE);
        //   }

        //   break;

        default:
          console.warn(`[Session ${sessionId}] Unandled session mode: ${currentState.mode}`);
          setSessionMode(session, sessionId, SessionMode.IDLE);
      }
    });

    cleanupHandlers.push(transcriptionHandler);
  }

  // Head position events
  if (settings.isHeadsUpDisplay.value) {
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
    console.error('Error:', error);
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
    console.log(`[Session ${sessionId}] Cleaned up session state.`);
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
          console.error('Music play error:', error);
          session.layouts.showTextWall('Error playing music.', {durationMs: 5000});
        }
        break;

      case PlayerCommand.PAUSE:
        try {
          await spotifyService.pauseTrack(sessionId);
          await displayCurrentlyPlaying(session, sessionId);
        } catch (error) {
          console.error('Music pause error:', error);
          session.layouts.showTextWall('Error pausing music.', {durationMs: 5000});
        }
        break;

      default:
        console.warn(`Unhandled player command: ${command}`);
        break;
    }
  } catch (error){
    console.error(`Spotify API error during command ${command}:`, error);
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

    await sleep(500)
    const playbackInfo = await spotifyService.getCurrentlyPlaying(sessionId);
    
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
    console.error('Error displaying current track:', error);
    session.layouts.showTextWall('Error getting track information', {durationMs: 5000});
  }
}

function getSessionState(sessionId: string): SessionState {
  if (!sessionStates.has(sessionId)) {
    console.warn(`[Session ${sessionId}] State not found, initializing to IDLE.`);
    sessionStates.set(sessionId, {mode: SessionMode.IDLE, timeoutId: null});
  }

  return sessionStates.get(sessionId)!;
}

function setSessionMode(session: TpaSession, sessionId: string, newMode: SessionMode, options?: {data?: any; timeoutMs?: number; timeoutMessage?: string}): void {
  const currentState = getSessionState(sessionId);

  if (currentState.timeoutId) {
    clearTimeout(currentState.timeoutId);
  }

  let newTimeoutId: NodeJS.Timeout | null = null;
  if (options?.timeoutMs) {
    newTimeoutId = setTimeout(() => {
      const timedOutState = sessionStates.get(sessionId);
      if (timedOutState && timedOutState.mode === newMode) {
        sessionStates.set(sessionId, {...timedOutState, mode: SessionMode.IDLE, timeoutId: null, data: undefined});
        session.layouts.showTextWall(options.timeoutMessage || 'Action timed out.', {durationMs: 5000});
      }
    }, options.timeoutMs);
  }

  const newState: SessionState = {
    mode: newMode,
    timeoutId: newTimeoutId,
    data: options?.data,
  };

  sessionStates.set(sessionId, newState);
}

async function enterShazamMode(session: TpaSession, sessionId: string): Promise<void> {
  session.layouts.showTextWall('Listening for song...', {durationMs: 10000 - 500});
  setSessionMode(session, sessionId, SessionMode.LISTENING_FOR_SHAZAM, {
    timeoutMs: 10000,
    timeoutMessage: 'Shazam cancelled. No speech detected.'
  });
}

async function handleShazamInput(session: TpaSession, sessionId: string, transcript: string): Promise<void> {
  console.log(`[Session ${sessionId}] Processing Shazam input: "${transcript}"`);
  setSessionMode(session, sessionId, SessionMode.IDLE);

  if (!transcript || transcript.trim().length === 0) {
    console.log(`[Session ${sessionId}] Empty transcript received for Shazam.`)
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
    console.error(`[Session ${sessionId}] Shazam service error:`, error);
    session.layouts.showTextWall('Error identifying song via Shazam.', {durationMs: 5000});
  }
}

async function triggerShazam(session: TpaSession, sessionId: string): Promise<void> {
  console.log(`[Session ${sessionId}] Triggering shazam listening mode.`);
  await enterShazamMode(session, sessionId);
}

async function enterDeviceSelectionMode(session: TpaSession, sessionId: string, devices: DeviceInfo[]): Promise<void> {
  const devicesToShow = devices.slice(0, 3);
  let deviceList = 'Say the number to select device:\n\n';

  devicesToShow.forEach((device, index) => {
    deviceList += `${index + 1}: ${device.name} (${device.type})\n`;
  });

  if (devices.length > 3) {
    deviceList += `... (${devices.length - devicesToShow.length} more)`;
  }

  session.layouts.showTextWall(deviceList.trim(), {durationMs: 10000 - 500});
  setSessionMode(session, sessionId, SessionMode.AWAITING_DEVICE_SELECTION, {
    data: devicesToShow,
    timeoutMs: 10000,
    timeoutMessage: 'Device selection cancelled (timeout).'
  });
}