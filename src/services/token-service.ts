import fs from 'fs';
import path from 'path';
import crypto from 'crypto'
import {SpotifyCredentials} from '../types';
import {config} from '../config/environment'

export class TokenService {
  private userTokens: Map<string, SpotifyCredentials> = new Map();
  private readonly tokenFilePath: string;
  private algoritm = 'aes-256-gcm';
  private secretKey: Buffer = Buffer.from(config.encryption.key, 'base64');
  private ivLength = 16;

  constructor() {
    // Create a data directory if it doesn't exist
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    this.tokenFilePath = path.join(dataDir, 'spotify_tokens.json');
    this.loadTokens();
  }
  
  private encrypt(text: string): string {
    if (!this.secretKey || this.secretKey.length !== 32) {
      console.error('Invalid secretKey length or configuration for encryption.');
    }

    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algoritm, this.secretKey, iv);
    let encrypted = cipher.update(text, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  private decrypt(encryptedText: string): string {
    if (!this.secretKey || this.secretKey.length !== 32) {
      console.error('Invalid secretKey length or configuration for decryption.');
    }

    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      console.error('Invalid encrypted text format.');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2]
    const decipher = crypto.createDecipheriv(this.algoritm, this.secretKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');

    return decrypted;
  }

  public getToken(sessionId: string): SpotifyCredentials | undefined {
    const encryptedCreds = this.userTokens.get(sessionId);
    if (encryptedCreds) {
      const accessToken = this.decrypt(encryptedCreds.accessToken);
      const refreshToken = this.decrypt(encryptedCreds.refreshToken);
      return {...encryptedCreds, accessToken, refreshToken};
    }

    return undefined;
  }

  public setToken(sessionId: string, credentials: SpotifyCredentials): void {
    const encryptedAccessToken = this.encrypt(credentials.accessToken);
    const encryptedRefreshToken = this.encrypt(credentials.refreshToken);
    this.userTokens.set(sessionId, {...credentials, accessToken: encryptedAccessToken, refreshToken: encryptedRefreshToken});
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
    const tokensToSave: { [key: string]: any } = {}; // Use 'any' temporarily or define a storage type
    for (const [sessionId, credentials] of this.userTokens.entries()) {
      try {
        tokensToSave[sessionId] = {
          ...credentials, // Keep non-sensitive fields
          accessToken: this.encrypt(credentials.accessToken), // Encrypt before saving
          refreshToken: this.encrypt(credentials.refreshToken), // Encrypt before saving
        };
      } catch (error) {
        console.error(`Error encrypting token for session ${sessionId} during save:`, error);
        break;
      }
    }

    try {
      fs.writeFileSync(this.tokenFilePath, JSON.stringify(tokensToSave, null, 2));
      console.log('Tokens saved to file (encrypted)');
    } catch (error) {
      console.error('Error writing tokens file:', error);
    }
  }
  
  private loadTokens(): void {
    try {
      if (!fs.existsSync(this.tokenFilePath)) {
        console.log('No saved tokens file found.');
        this.userTokens = new Map(); // Ensure map is empty if file doesn't exist
        return;
      }

      const fileContent = fs.readFileSync(this.tokenFilePath, 'utf8');
        // Handle empty file case to prevent JSON parsing errors
      if (!fileContent.trim()) {
        console.log('Token file is empty.');
        this.userTokens = new Map();
        return;
      }

      // Parse the JSON object containing encrypted tokens
      const encryptedTokensObj = JSON.parse(fileContent);
      const loadedTokens = new Map<string, SpotifyCredentials>();

      // Iterate through each session's encrypted credentials
      for (const [sessionId, storedCreds] of Object.entries(encryptedTokensObj)) {
        // Basic validation - ensure it looks like a credential object with strings to decrypt
        if (typeof storedCreds !== 'object' || storedCreds === null || typeof storedCreds.accessToken !== 'string' || typeof storedCreds.refreshToken !== 'string') {
          console.warn(`Skipping token for session ${sessionId} due to invalid format in storage.`);
          continue;
        }

        try {
          // Decrypt the sensitive fields
          const accessToken = this.decrypt(storedCreds.accessToken);
          const refreshToken = this.decrypt(storedCreds.refreshToken);

          // Create the actual SpotifyCredentials object for in-memory use
          const decryptedCredentials: SpotifyCredentials = {
              ...(storedCreds as object), // Cast to allow spreading, assuming other fields are compatible
              accessToken: accessToken,
              refreshToken: refreshToken,
          };

          // Add the successfully decrypted token to our temporary map
          loadedTokens.set(sessionId, decryptedCredentials);
        } catch (error) {
            // Log specific decryption errors
            console.error(`Failed to decrypt token for session ${sessionId}. Skipping. Error:`, error instanceof Error ? error.message : error);
        }
      }

      // Replace the in-memory map with the newly loaded and decrypted tokens
      this.userTokens = loadedTokens;
      console.log(`Loaded and decrypted ${this.userTokens.size} tokens from storage.`);
    } catch (error) {
      // Catch errors related to file reading or JSON parsing
      console.error('Error reading or parsing tokens file:', error);
      // Fallback to an empty map in case of critical loading errors
      this.userTokens = new Map();
    }
  }
}

export const tokenService = new TokenService();