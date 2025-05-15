#!/bin/bash
# Simple EC2 setup script for Music Player for AugmentOS

# Make script exit on error
set -e

echo "=== Music Player for AugmentOS EC2 Setup ==="

# 1. Check for Bun
if ! command -v bun &> /dev/null; then
    echo "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    source ~/.bashrc
fi

# 2. Install screen for persistent sessions
if ! command -v screen &> /dev/null; then
    echo "Installing screen..."
    sudo yum install -y screen
fi

# 3. Get EC2 metadata
echo "Getting EC2 metadata..."
PUBLIC_DNS=$(curl -s http://169.254.169.254/latest/meta-data/public-hostname)
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)

echo "Public DNS: $PUBLIC_DNS"
echo "Public IP: $PUBLIC_IP"

# 4. Create example .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating example .env file..."
    cat > .env << EOL
# EC2 Info
PUBLIC_DNS=$PUBLIC_DNS
PUBLIC_IP=$PUBLIC_IP
WEB_PORT=4040

# Your credentials - FILL THESE IN
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
AUGMENTOS_API_KEY=your_augmentos_api_key
AUGMENTOS_PACKAGE_NAME=org.gikaeh.music-player-for-augment-os
TOKEN_ENCRYPTION_KEY=random_string_for_encryption
EOL

    echo "Created .env file - IMPORTANT: Edit this file to add your credentials!"
    echo "Also add this redirect URI to your Spotify Developer Dashboard:"
    echo "http://$PUBLIC_DNS:4040/callback"
fi

# 5. Install dependencies
echo "Installing dependencies with Bun..."
bun install

echo "=== Setup Complete ==="
echo "To start the application, run: bun index.ts"
echo "Or for persistent operation:"
echo "  screen -S music-player"
echo "  bun index.ts"
echo "  (Detach with Ctrl+A, D)"