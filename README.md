# MusicPlayer - Music Player for AugmentOS

## Usage

### Installation

1. Set up environment variables:
   ```
   AUGMENTOS_API_KEY=your_augment_api_key
   AUGMENTOS_WS_URL=wss://staging.augmentos.org/tpa-ws (optional)
   SPOTIFY_CLIENT_ID=your_spotify_client_id
   SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
   WEB_URL=http://localhost (optional: switch with ngrok if using)
   WEB_PORT=4040 (optional)
   REDIRECT_URI=http://localhost:4040/callback (optional: switch with ngrok if using)
   AUTH_PORT=4041 (optional)
   ```

2. Install dependencies:
   ```
   bun install
   ```

3. Build and start the server:
   ```
   bun run src/index.ts
   ```

### Voice Commands

- "Refresh Spotify" - Display Now Playing music with artist and album

## Development

### Adding Controls

1. Add touch controls for playing, skipping, & rewinding songs
2. Add voice commands for playing, skipping, & rewinding songs

### Planned

- Apple Music integration

## License

MIT 
