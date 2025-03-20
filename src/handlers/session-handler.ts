import { TpaSession } from '@augmentos/sdk';
import { spotifyService } from '../services/spotify-service';
import { tokenService } from '../services/token-service';
import { config } from '../config/environment';
import { setTimeout } from 'timers/promises';

// Player command actions
export enum PlayerCommand {
  CURRENT = 'current',
  NEXT = 'next',
  BACK = 'back',
  PLAY = 'play',
  PAUSE = 'pause'
}

// Handle player commands
export async function handlePlayerCommand(session: TpaSession, sessionId: string, command: PlayerCommand): Promise<void> {
  // Check if user is authenticated
  if (!tokenService.hasToken(sessionId)) {
    session.layouts.showTextWall('Please connect your Spotify account first.', { durationMs: 5000 });
    return;
  }

  // Refresh token if needed
  const tokenValid = await spotifyService.refreshTokenIfNeeded(sessionId);
  if (!tokenValid) {
    session.layouts.showTextWall('Error refreshing Spotify connection. Please reconnect your account.');
    return;
  }

  try {
    switch (command) {
      case PlayerCommand.CURRENT:
        await setTimeout(500);
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
          session.layouts.showTextWall('Error playing music.', { durationMs: 5000 });
        }
        break;

      case PlayerCommand.PAUSE:
        try {
          await spotifyService.pauseTrack(sessionId);
          await displayCurrentlyPlaying(session, sessionId);
        } catch (error) {
          console.error('Music pause error:', error);
          session.layouts.showTextWall('Error pausing music.', { durationMs: 5000 });
        }
        break;
      
      default:
        console.error(`Error: updateNowPlaying switch has ${command} type`);
        break;
    }
  } catch (error) {
    console.error('Spotify API error:', error);
    session.layouts.showTextWall('Error connecting to Spotify. Please try again.', { durationMs: 5000 });
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

    const playbackInfo = await spotifyService.getCurrentlyPlaying(sessionId);
    
    if (playbackInfo.trackName) {
      const displayText = 
        `${playbackInfo.isPlaying ? 'Now Playing' : 'Paused'}\n\n` +
        `Song: ${playbackInfo.trackName}\n` +
        `Artist: ${playbackInfo.artists}\n` +
        `Album: ${playbackInfo.albumName}`;
      
      // Debug display
      console.log(displayText);
      
      // Display the now playing information
      session.layouts.showTextWall(displayText, { durationMs: 5000 });
    } else {
      // Nothing is playing
      console.log('No track currently playing on Spotify');
      session.layouts.showTextWall('No track currently playing on Spotify', { durationMs: 5000 });
    }
  } catch (error) {
    console.error('Error displaying current track:', error);
    session.layouts.showTextWall('Error getting track information', { durationMs: 5000 });
  }
}

// Set up session event handlers
// Set up session event handlers
export function setupSessionHandlers(session: TpaSession, sessionId: string): Array<() => void> {
  const cleanupHandlers: Array<() => void> = [];

  // Listen for user command via transcription
  const transcriptionHandler = session.events.onTranscription((data) => {
    const commandMappings = {
      [PlayerCommand.CURRENT]: ['current.', 'what\'s playing', 'now playing', 'current song'],
      [PlayerCommand.NEXT]: ['next.', 'next song', 'skip song'],
      [PlayerCommand.BACK]: ['back.', 'previous.', 'previous song', 'rewind.'],
      [PlayerCommand.PLAY]: ['play.', 'play music', 'play song'],
      [PlayerCommand.PAUSE]: ['pause.', 'pause music', 'pause song']
    };

    if (data.isFinal) {
      const lowerText = data.text.toLowerCase();
      
      // Check each command type and its phrases
      for (const [command, phrases] of Object.entries(commandMappings)) {
        for (const phrase of phrases) {
          if (lowerText.includes(phrase)) {
            handlePlayerCommand(session, sessionId, command as PlayerCommand);
            break;
          }
        }
      }
    }
  });

  // Head position events
  const headPositionHandler = session.events.onHeadPosition((data) => {
    if (data.position === 'up') {
      handlePlayerCommand(session, sessionId, PlayerCommand.CURRENT);
    }
  });

  // Error handler
  const errorHandler = session.events.onError((error) => {
    console.error('Error:', error);
    session.layouts.showTextWall(`Error: ${error.message}`);
  });

  // Add handlers to the cleanup array
  cleanupHandlers.push(transcriptionHandler, headPositionHandler, errorHandler);
  
  // Return all cleanup handlers
  return cleanupHandlers;
}