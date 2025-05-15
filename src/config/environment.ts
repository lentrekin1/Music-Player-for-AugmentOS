import dotenv from 'dotenv';

// Load env variables
dotenv.config();

// Helper to get public URL for EC2 deployment
function getPublicUrl(): string {
  // First check if WEB_URL is explicitly set
  if (process.env.WEB_URL) {
    return process.env.WEB_URL;
  }
  
  // For EC2 deployments where PUBLIC_DNS or PUBLIC_IP is available
  const publicDns = process.env.PUBLIC_DNS;
  const publicIp = process.env.PUBLIC_IP;
  const port = process.env.WEB_PORT || 4040;
  
  if (publicDns) {
    return `http://${publicDns}:${port}`;
  }
  
  if (publicIp) {
    return `http://${publicIp}:${port}`;
  }
  
  // Default fallback for local development
  return `http://localhost:${port}`;
}

// Calculate the public URL once at startup
const publicUrl = getPublicUrl();

export const config = {
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID || 'YOUR_CLIENT_ID',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || 'YOUR_CLIENT_SECRET',
    redirectUri: process.env.REDIRECT_URI || `${publicUrl}/callback`
  },
  server: {
    webUrl: publicUrl,
    port: process.env.WEB_PORT || 4040,
    authPort: process.env.AUTH_PORT
  },
  augmentOS: {
    apiKey: process.env.AUGMENTOS_API_KEY || '',
    packageName: process.env.AUGMENTOS_PACKAGE_NAME || 'org.gikaeh.music-player-for-augment-os'
  },
  encryption: {
    key: process.env.TOKEN_ENCRYPTION_KEY
  },
  logging: {
    appState: process.env.NODE_ENV
  }
};

// Log environment configuration
export function logEnvironment() {
  console.log('=== Environment Variables ===');
  console.log(`Public URL: ${config.server.webUrl}`);
  console.log(`PORT: ${config.server.port}`);
  console.log(`AUGMENTOS_API_KEY: ${config.augmentOS.apiKey ? 'Set' : 'Not set'}`);
  console.log(`REDIRECT_URI: ${config.spotify.redirectUri}`);
}