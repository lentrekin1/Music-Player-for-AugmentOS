package com.music.musicplayer;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

import androidx.appcompat.app.AppCompatActivity;

public class LauncherActivity extends AppCompatActivity {
    private static final String TAG = "SpotifyLauncherActivity";
    private static final String SPOTIFY_CLIENT_ID = "YOUR_SPOTIFY_CLIENT_ID_HERE";
    private static final String SPOTIFY_REDIRECT_URI = "augmentosapp://callback";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.d(TAG, "SpotifyLauncherActivity started");

        // Check if we're receiving a callback from Spotify
        Uri uri = getIntent().getData();
        if (uri != null && uri.toString().startsWith(SPOTIFY_REDIRECT_URI)) {
            // This is a callback from Spotify
            handleSpotifyCallback(uri);
        } else {
            // Normal app startup
            startSpotifyService();
        }

        // Always finish this activity after handling intent
        finish();
    }

    private void startSpotifyService() {
        // Start our service
        Intent serviceIntent = new Intent(this, MusicPlayerAugmentosAppService.class);
        startService(serviceIntent);
    }

    private void handleSpotifyCallback(Uri uri) {
        // Get token from URI fragment
        String fragment = uri.getFragment();
        if (fragment != null) {
            String[] params = fragment.split("&");
            for (String param : params) {
                if (param.startsWith("access_token=")) {
                    String accessToken = param.substring("access_token=".length());
                    saveAndBroadcastToken(accessToken);
                    break;
                }
            }
        }

        // Start the service
        startSpotifyService();
    }

    private void saveAndBroadcastToken(String token) {
        // Save token to preferences
        SharedPreferences prefs = getSharedPreferences("SpotifyPrefs", MODE_PRIVATE);
        prefs.edit().putString("spotify_token", token).apply();

        // Intent to update our service with the new token
        Intent tokenIntent = new Intent(this, MusicPlayerAugmentosAppService.class);
        tokenIntent.setAction("UPDATE_SPOTIFY_TOKEN");
        tokenIntent.putExtra("token", token);
        startService(tokenIntent);
    }

    // Method to initiate the Spotify authentication
    public void authenticateWithSpotify() {
        // Construct the Spotify Auth URL
        Uri.Builder builder = new Uri.Builder();
        builder.scheme("https")
                .authority("accounts.spotify.com")
                .appendPath("authorize")
                .appendQueryParameter("client_id", SPOTIFY_CLIENT_ID)
                .appendQueryParameter("response_type", "token")
                .appendQueryParameter("redirect_uri", SPOTIFY_REDIRECT_URI)
                .appendQueryParameter("scope", "user-read-currently-playing user-read-playback-state");

        // Create and start the intent
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setData(builder.build());
        startActivity(intent);
    }
}
