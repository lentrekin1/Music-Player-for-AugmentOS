# Running on AWS EC2

This guide explains how to run the Music Player for AugmentOS on an AWS EC2 instance so it can be accessed by your AugmentOS glasses from anywhere.

## Quick Setup

1. SSH into your EC2 instance
2. Clone this repository
3. Run the setup script
4. Start the application

```bash
# Clone repository
git clone https://github.com/lentrekin1/Music-Player-for-AugmentOS.git
cd Music-Player-for-AugmentOS

# Make setup script executable
chmod +x ec2-setup.sh

# Run setup script
./ec2-setup.sh

# Edit the .env file with your credentials
nano .env

# Start the application with screen (for persistence)
screen -S music-player
bun index.ts
# Detach with Ctrl+A, D
```

## Important Spotify Configuration

To use Spotify authentication, you must add your EC2 instance's callback URL to your Spotify Developer Dashboard:

1. Go to https://developer.spotify.com/dashboard/
2. Select your app
3. Go to "Edit Settings"
4. Add this Redirect URI: `http://your-ec2-public-dns:4040/callback`
   - Replace `your-ec2-public-dns` with your actual EC2 public DNS
   - Example: `http://ec2-18-119-113-142.us-east-2.compute.amazonaws.com:4040/callback`

## Connecting from AugmentOS Glasses

When using the app from your glasses, use the EC2 instance's URL:
- Public DNS: `ec2-18-119-113-142.us-east-2.compute.amazonaws.com` (your actual DNS will differ)
- Port: 4040

## Troubleshooting

- **Can't access the application**: Check that port 4040 is open in your EC2 security group
- **App crashes**: Check for any error messages in the console output
- **Authentication issues**: Verify your Spotify API credentials and redirect URI configuration
- **EC2 instance restarted**: Public DNS might change; update your .env file and Spotify dashboard if needed

## Reconnecting to a Running Session

If you disconnected from your SSH session while the app was running in screen:

```bash
# Reconnect to screen session
screen -r music-player

# If you need to stop the app, press Ctrl+C
# To detach again: Ctrl+A, D
```