import {TpaSession} from '@augmentos/sdk';
import {setTimeout as sleep} from 'timers/promises';
import logger from '../utils/logger'
import {DeviceInfo, SessionState} from '../types'
import {tokenService} from '../services/token-service';
import {spotifyService} from '../services/spotify-service';
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
  [PlayerCommand.TRIGGER_DEVICE_LIST]: ['show devices', 'list devices', 'change device', 'select device']
}

// Set up session event handlers
export function setupSessionHandlers(session: TpaSession, sessionId: string, settings: any): Array<() => void> {
  // Array for handler cleanup
  const cleanupHandlers: Array<() => void> = [];
  logger.debug(settings);

  // Initialize base sessionState to idle
  sessionStates.set(sessionId, {mode: SessionMode.IDLE, timeoutId: null, pendingCommand: undefined});
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

                  case PlayerCommand.TRIGGER_DEVICE_LIST:
                    await triggerDeviceList(session, sessionId);
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

        case SessionMode.AWAITING_DEVICE_SELECTION:
          if (currentState.data && Array.isArray(currentState.data)) {
            await handleDeviceSelectionInput(session, sessionId, lowerText, currentState.data as DeviceInfo[]);
          } else {
            logger.warn(`[Session ${sessionId}] Missing device data in AWAITING_DEVICE_SELECTION mode.`, {
              sessionId: sessionId,
              settings: settings,
              mode: currentState.mode,
              timeoutId: currentState.timeoutId,
              currentStateData: currentState.data
            });
            session.layouts.showTextWall('Internal error: Device list missing.', {durationMs: 5000});
            setSessionMode(session, sessionId, SessionMode.IDLE);
          }

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
  logger.info(`[Session ${sessionId}] Handling command ${command}`, {
    sessionId: sessionId,
    command: command
  });

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
        await spotifyService.playTrack(sessionId);
        await displayCurrentlyPlaying(session, sessionId);
        break;

      case PlayerCommand.PAUSE:
        await spotifyService.pauseTrack(sessionId);
        await displayCurrentlyPlaying(session, sessionId);
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
    
    if (error.message?.includes('NO_ACTIVE_DEVICE')) { 
      logger.warn(`[Session ${sessionId}] No active device detected for command '${command}'. Auto-triggereing device list.`);
      await triggerDeviceList(session, sessionId, command);
    } else  {
      let userMessage = 'Error executing command. Please try again.';
      
      if (error.response?.data?.error?.message) { 
      userMessage = `Spotify Error: ${error.response.data.error.message}`;
      }

      session.layouts.showTextWall(userMessage, {durationMs: 5000});
    }
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
    logger.warn(`[Session ${sessionId}] State not found, initializing to IDLE.`);
    sessionStates.set(sessionId, {mode: SessionMode.IDLE, timeoutId: null, pendingCommand: undefined});
  }

  // Return sessionState for sessionId
  return sessionStates.get(sessionId)!;
}

function setSessionMode(session: TpaSession, sessionId: string, newMode: SessionMode, options?: {data?: any; timeoutMs?: number; timeoutMessage?: string, pendingCommand?: PlayerCommand}): void {
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
        sessionStates.set(sessionId, {...timedOutState, mode: SessionMode.IDLE, timeoutId: null, data: undefined, pendingCommand: undefined});
        session.layouts.showTextWall(options.timeoutMessage || 'Action timed out.', {durationMs: 5000});
      }
    }, options.timeoutMs);
  }

  // Set new state with provided parameters
  const newState: SessionState = {
    mode: newMode,
    timeoutId: newTimeoutId,
    data: options?.data,
    pendingCommand: options?.pendingCommand
  };

  sessionStates.set(sessionId, newState);
  logger.info(`[Session ${sessionId}] Mode changed to ${SessionMode[newMode]}`, {
    newMode: SessionMode[newMode],
    sessionId: sessionId,
    hasData: options?.data !== undefined,
    timeoutSet: options?.timeoutMs !== undefined,
    pendingCommandSet: options?.pendingCommand !== undefined
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

async function triggerDeviceList(session: TpaSession, sessionId: string, pendingCommand?: PlayerCommand): Promise<void> {
  logger.info(`[Session ${sessionId}] Triggering device list and selection mode.`, {
    pendingCommand: pendingCommand
  });
  try {
    const tokenValid = await spotifyService.refreshTokenIfNeeded(sessionId);
    if (!tokenValid) {
      session.layouts.showTextWall('Spotify connection issue. Please reconnect account.', { durationMs: 5000 });
      setSessionMode(session, sessionId, SessionMode.IDLE);
      return;
    }

    const devices = await spotifyService.getDevice(sessionId);
    const deviceArray: DeviceInfo[] = devices.map((device: any) => ({
      name: device.name, type: device.type, id: device.id,
    }));

    logger.debug(`[Session ${sessionId}] Found devices:`, deviceArray);

    if (deviceArray.length === 0) {
      session.layouts.showTextWall('Open Spotify on a device to begin playback.', { durationMs: 5000 });
      setSessionMode(session, sessionId, SessionMode.IDLE);
    } else if (deviceArray.length === 1) {
      session.layouts.showTextWall(`Playing on: ${deviceArray[0].name} (${deviceArray[0].type})`, { durationMs: 5000 });
      // Auto set device since there's only one
      await spotifyService.setDevice(sessionId, [deviceArray[0].id]);
      setSessionMode(session, sessionId, SessionMode.IDLE);
      if (pendingCommand) {
        logger.info(`[Session ${sessionId}] Single device auto-selected. Retrying pending command: ${pendingCommand}`);
        await sleep(500);
        await handlePlayerCommand(session, sessionId, pendingCommand)
      }
    } else {
      // More than one device, enter selection mode
      await enterDeviceSelectionMode(session, sessionId, deviceArray, pendingCommand);
    }
  } catch (error) {
    logger.error(`[Session ${sessionId}] Error fetching devices for listing.`, {
      sessionId: sessionId,
      error: {
        message: error.message,
        stack: error.stack,
        responseStatus: error.response?.status,
        responseBody: error.response?.data 
      }
    });
    session.layouts.showTextWall('Error getting Spotify device list.', { durationMs: 5000 });
    setSessionMode(session, sessionId, SessionMode.IDLE);
  }
}

async function enterDeviceSelectionMode(session: TpaSession, sessionId: string, devices: DeviceInfo[], pendingCommand?: PlayerCommand): Promise<void> {
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
    timeoutMessage: 'Device selection cancelled (timeout).',
    pendingCommand: pendingCommand
  });
}

async function handleDeviceSelectionInput(session: TpaSession, sessionId: string, transcript: string, availableDevices: DeviceInfo[]): Promise<void> {
  logger.debug(`[Session ${sessionId}] Processing device selection input: "${transcript}"`);
  const stateBeforeReset = getSessionState(sessionId);
  const commandToRetry = stateBeforeReset.pendingCommand;
  setSessionMode(session, sessionId, SessionMode.IDLE);

  if (!availableDevices || availableDevices.length === 0) {
    logger.warn(`[Session ${sessionId}] Device selection input received, but no devices were stored in state.`);
    session.layouts.showTextWall('Internal error: Device list lost.', { durationMs: 5000 });
    return;
  }

  const selectedNumber = parseNumberFromTranscript(transcript);

  if (selectedNumber !== null && selectedNumber >= 1 && selectedNumber <= availableDevices.length) {
    const selectedDeviceIndex = selectedNumber - 1;
    const selectedDevice = availableDevices[selectedDeviceIndex];

     if (!selectedDevice || !selectedDevice.id) {
        logger.warn(`[Session ${sessionId}] Internal error: Invalid device found at index ${selectedDeviceIndex}`);
        session.layouts.showTextWall('Internal error selecting device.', { durationMs: 5000 });
        return;
     }

    logger.info(`[Session ${sessionId}] User selected device number ${selectedNumber}: ${selectedDevice.name} (ID: ${selectedDevice.id})`);
    session.layouts.showTextWall(`Selecting: ${selectedDevice.name}...`, { durationMs: 5000 });

    try {
      await spotifyService.setDevice(sessionId, [selectedDevice.id]);
      logger.debug(`[Session ${sessionId}] Successfully set device to ${selectedDevice.id}`);
      session.layouts.showTextWall(`Device set to: ${selectedDevice.name}`, { durationMs: 5000 });

      if (commandToRetry) {
        logger.info(`[Session ${sessionId}] Device selected. Retrying original command: ${commandToRetry}`);
        await sleep(500);
        await handlePlayerCommand(session, sessionId, commandToRetry);
      } else {
        await displayCurrentlyPlaying(session, sessionId);
      }
    } catch (error) {
      logger.error(`[Session ${sessionId}] Error setting Spotify device.`, {
        sessionId: sessionId,
        selectedNumber: selectedNumber,
        devices: availableDevices,
        error: {
          message: error.message,
          stack: error.stack,
          responseStatus: error.response?.status,
          responseBody: error.response?.data 
        }
      });
      session.layouts.showTextWall(`Error selecting ${selectedDevice.name}.`, { durationMs: 5000 });
    }
  } else {
    logger.info(`[Session ${sessionId}] Invalid device selection input: "${transcript}" (Parsed: ${selectedNumber})`);
    let feedback = 'Invalid selection.';
    if (selectedNumber !== null) {
      feedback = `Please say a number between 1 and ${availableDevices.length}.`;
    }
    session.layouts.showTextWall(feedback, { durationMs: 5000 });
  }
}

function parseNumberFromTranscript(text: string): number | null {
  const lowerText = text.toLowerCase().trim();
  const numberMap: { [key: string]: number } = {
    'one': 1, '1': 1,
    'two': 2, '2': 2, 'to': 2, 'too': 2,
    'three': 3, '3': 3,
  };
  if (lowerText in numberMap) return numberMap[lowerText];
  const parsedInt = parseInt(lowerText, 10);
  if (!isNaN(parsedInt)) return parsedInt;
  return null;
}