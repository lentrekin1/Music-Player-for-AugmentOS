import {TpaServer, TpaSession} from '@augmentos/sdk';
import {createExpressApp} from './app';
import axios from 'axios';
import {config} from './config/environment';
import {tokenService} from './services/token-service';
import {setupSessionHandlers, displayCurrentlyPlaying} from './handlers/session-handler';
import logger from './utils/logger';
import {SettingKey, ProcessedUserSettings} from './types/index'

export class MusicPlayerServer extends TpaServer {
  private activeUserSessions = new Map<string, {session: TpaSession, sessionId: string}>();

  constructor() {
    super({
      packageName: config.augmentOS.packageName,
      apiKey: config.augmentOS.apiKey,
      port: config.server.port
    });

    // Get the Express app for adding custom routes
    const app = this.getExpressApp();

    // Merge with our app that has auth routes set up
    const customApp = createExpressApp();
    app.use(customApp);

    // Start auth server on separate port if provided
    if (config.server.authPort) {
      app.listen(config.server.authPort, () => {
        logger.info(`Authentication server running on port ${config.server.authPort}`, {
          authPort: config.server.authPort
        });
      });
    }
  }

  // Called when new user connects to app
  protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
    logger.info(`New session started: ${sessionId} for user: ${userId}`, {
      sessionId: sessionId,
      userId: userId
    });
    
    // Store session to access it later
    this.setActiveUserSession(userId, session, sessionId)

    const userSettings = await this.pullUserSettings(userId)

    // Check if user is already authenticated with Spotify
    if (tokenService.hasToken(userId)) {
      // User is authenticated, start showing now playing info
      await displayCurrentlyPlaying(session, userId);
    } else {
      // User needs to authenticate
      const loginUrl = `${config.server.webUrl}/login/${userId}`;
      logger.debug(loginUrl);
      session.layouts.showTextWall(
        `Please visit the following URL on your phone or computer to connect your Spotify account: ${loginUrl}`,
        {durationMs: 5000}
      );
    }

    // Set up event handlers for this session and get the cleanup handlers
    const handlers = setupSessionHandlers(session, userId, userSettings);
    
    // Use the parent class's addCleanupHandler method instead of managing our own array
    handlers.forEach(handler => this.addCleanupHandler(handler));
  }

  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    logger.info(`Session stopped: ${sessionId} for user: ${userId}. Reason: ${reason}`, {
      sessionId: sessionId, 
      userId: userId,
      reason: reason
    });
    
    // The parent class will automatically handle the cleanup handlers
    // We just need to remove our session from the active sessions map
    this.removeActiveUserSession(userId);
    
    // Call the parent class's onStop method to ensure proper cleanup
    await super.onStop(sessionId, userId, reason);
  }

  public getActiveUserSession(userId: string): {session: TpaSession, sessionId: string} | null {
    return this.activeUserSessions.get(userId) || null;
  }

  public setActiveUserSession(userId: string, session: TpaSession, sessionId: string): void {
    this.activeUserSessions.set(userId, {session: session, sessionId: sessionId});
  }

  public removeActiveUserSession(userId: string): void {
    this.activeUserSessions.delete(userId);
  }

  public async pullUserSettings(userId: string): Promise<any | null> {
    try {
      logger.info(`Fetching settings for user ${userId}`);
      const response = await axios.get(`http://cloud.augmentos.org/tpasettings/user/${config.augmentOS.packageName}`, {
        headers: { Authorization: `Bearer ${userId}` }
      });
      const settingsArray: any[] = response.data.settings;
      logger.info(`Fetched settings for user ${userId}: ${settingsArray}`);

      const processedSettings: ProcessedUserSettings = {
        musicPlayer: 'spotify',
        isVoiceCommands: true,
        isHeadsUpDisplay: false,
      };

      settingsArray.forEach(setting => {
        switch (setting.key) {
          case SettingKey.MUSIC_PLAYER:
            if (setting.value === 'android') {processedSettings.musicPlayer = 'android'}
            else if (setting.value === 'ios') {processedSettings.musicPlayer = 'ios'}
            else if (setting.value === 'spotify') {processedSettings.musicPlayer = 'spotify'}
            else {
              logger.warn(`[User ${userId}] Unknown music player value: ${setting.value}. Defaulting to spotify.`);
              processedSettings.musicPlayer = 'spotify'
            }
            break;

          case SettingKey.HEADS_UP_DISPLAY:
            processedSettings.isHeadsUpDisplay = !!setting.value;
            break;

          case SettingKey.VOICE_COMMANDS:
            processedSettings.isVoiceCommands = !!setting.value;
            break;

          default:
            logger.warn(`[User ${userId}] Encountered unknown setting key: ${setting.key}`);
            break;
        }
      });

      logger.info(`Applied settings for user ${userId}: headsUpDisplay=${processedSettings.isHeadsUpDisplay}, voiceCommands=${processedSettings.isVoiceCommands}`);
      return processedSettings;
    } catch (error){
      logger.error(`Error fetching settings for user ${userId}.`, {
        userId: userId,
        error: {
          message: error.message,
          stack: error.stack,
          responseStatus: error.response?.status,
          responseBody: error.response?.data 
        }
      });
      return null;
    }
  }
}

export const server = new MusicPlayerServer();
