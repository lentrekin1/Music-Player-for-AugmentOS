import fs from 'fs';
import path from 'path';
import {SpotifyCredentials} from '../types';

export class TokenService {
  private userTokens: Map<string, SpotifyCredentials> = new Map();
  private readonly tokenFilePath: string;

  constructor() {
    // Create a data directory if it doesn't exist
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    this.tokenFilePath = path.join(dataDir, 'spotify_tokens.json');
    this.loadTokens();
  }

  public getToken(sessionId: string): SpotifyCredentials | undefined {
    return this.userTokens.get(sessionId);
  }

  public setToken(sessionId: string, credentials: SpotifyCredentials): void {
    this.userTokens.set(sessionId, credentials);
    this.saveTokens();
  }

  public removeToken(sessionId: string): void {
    if (this.userTokens.has(sessionId)) {
      this.userTokens.delete(sessionId);
      this.saveTokens();
      console.log(`Removed token for session ${sessionId}`);
    }
  }

  public hasToken(sessionId: string): boolean {
    return this.userTokens.has(sessionId);
  }

  private saveTokens(): void {
    // Convert Map to an object that can be serialized
    const tokensObj = Object.fromEntries(this.userTokens);
    
    // Write tokens to a JSON file
    fs.writeFileSync(this.tokenFilePath, JSON.stringify(tokensObj, null, 2));
    console.log('Tokens saved to file');
  }
  
  private loadTokens(): void {
    try {
      if (fs.existsSync(this.tokenFilePath)) {
        const fileContent = fs.readFileSync(this.tokenFilePath, 'utf8');
        const tokensObj = JSON.parse(fileContent);
        
        // Convert the plain object back to a Map
        this.userTokens = new Map(Object.entries(tokensObj));
        console.log(`Loaded ${this.userTokens.size} tokens from storage`);
      } else {
        console.log('No saved tokens found');
      }
    } catch (error) {
      console.error('Error loading tokens:', error);
      // Keep the current empty Map if there's an error
    }
  }
}

export const tokenService = new TokenService();