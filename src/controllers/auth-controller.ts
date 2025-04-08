import { Router, Request, Response } from 'express';
import { spotifyService } from '../services/spotify-service';
import { activeSessions } from '../server';
import { displayCurrentlyPlaying } from '../handlers/session-handler';
import logger from '../utils/logger'

const router = Router();

// Handle spotify auth
router.get('/login/:sessionId', (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  const authUrl = spotifyService.createAuthorizationUrl(sessionId);
  res.redirect(authUrl);
});

// Handle callback from Spotify
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const sessionId = state as string;

  try {
    // Exchange authorization code for access token
    await spotifyService.handleAuthorizationCallback(code as string, sessionId);

    res.send('Authentication successful! You can close this window and return to your glasses.');

    // If there's a session active, display now playing information
    const session = activeSessions.get(sessionId);
    if (session) {
      await displayCurrentlyPlaying(session, sessionId);
    }
  } catch (error) {
    logger.error('Authentication error:', {
      sessionId: sessionId,
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

// router.post('/settings', async (req: Request, res: Response) => {
//   try {
//     const {userIdForSettings, settings} = req.body;
    
//     if (!userIdForSettings || !Array.isArray(settings)) {
//       return res.status(400).json({error: 'Missing userId or settings array in payload'});
//     }

//     const result = await this.updateSettings()
//   } catch {
    
//   }
// })

export const authRoutes = router;