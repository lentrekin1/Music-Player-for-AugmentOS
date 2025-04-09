import {Router, Request, Response} from 'express';
import {spotifyService} from '../services/spotify-service';
import {server} from '../server';
import {displayCurrentlyPlaying} from '../handlers/session-handler';
import logger from '../utils/logger'
import path from 'path'

const router = Router();

// Handle spotify auth
router.get('/login/:userId', (req: Request, res: Response) => {
  const userId = req.params.userId;
  const authUrl = spotifyService.createAuthorizationUrl(userId);
  res.redirect(authUrl);
});

// Handle callback from Spotify
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const userId = state as string;

  try {
    // Exchange authorization code for access token
    await spotifyService.handleAuthorizationCallback(code as string, userId);

    res.send('Authentication successful! You can close this window and return to your glasses.');

    // If there's a session active, display now playing information
    const session = server.getActiveUserSession(userId)?.session;

    if (session) {
      await displayCurrentlyPlaying(session, userId);
    }
  } catch (error) {
    logger.error('Authentication error:', {
      userId: userId,
      res: res,
      req: req,
      error: {
        message: error.message,
        stack: error.stack,
        responseStatus: error.response?.status,
        responseBody: error.response?.data 
      }
    });
    res.send('Authentication failed. Please try again.');
  }
});

const settingsJsonPathPublic = path.join(__dirname, '../public', 'tpa_config.json');
router.get('/tpa_config.json', async (req: Request, res: Response) => {
  try {
    res.sendFile(settingsJsonPathPublic)
  } catch (error) {
    logger.error('Authentication error:', {
      res: res,
      req: req,
      error: {
        message: error.message,
        stack: error.stack,
        responseStatus: error.response?.status,
        responseBody: error.response?.data 
      }
    });
    res.send('Error retrieving tpa_config.json')
  }
})

router.post('/settings', async (req: any, res: any) => {
  try {
    const {userIdForSettings, settings} = req.body;

    logger.debug(req.body);
    
    if (!userIdForSettings || !Array.isArray(settings)) {
      return res.send({error: 'Missing userId or settings array in payload'});
    }

    const result = await server.pullSettings(userIdForSettings, undefined, undefined, settings);
    res.json(result);
  } catch (error) {
    logger.error('Error in settings endpoint.', {
      req: req,
      res: res,
      error: {
        message: error.message,
        stack: error.stack,
        responseStatus: error.response?.status,
        responseBody: error.response?.data 
      }
    });
    res.send({error: 'Internal server error updating settings'})
  }
});


export const authRoutes = router;