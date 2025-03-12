package com.music.musicplayer;

import android.util.Log;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import com.augmentos.augmentoslib.AugmentOSLib;
import com.augmentos.augmentoslib.AugmentOSSettingsManager;
import com.augmentos.augmentoslib.SmartGlassesAndroidService;
import com.augmentos.augmentoslib.events.NotificationEvent;
import com.augmentos.augmentoslib.events.SpeechRecOutputEvent;
import com.augmentos.augmentoslib.events.GlassesSideTapEvent;
import com.augmentos.augmentoslib.events.TranslateOutputEvent;

import org.greenrobot.eventbus.Subscribe;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Timer;
import java.util.TimerTask;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class MusicPlayerAugmentosAppService extends SmartGlassesAndroidService {
    public final String TAG = "SpotifyService";

    // Our instance of the AugmentOS library
    public AugmentOSLib augmentOSLib;

    // Spotify API related variables
    private String spotifyAccessToken;
    private OkHttpClient httpClient;
    private Timer spotifyCheckTimer;
    private int POLL_INTERVAL_MS = 5000; // Default check every 5 seconds
    private String lastTrackId = "";

    // Track info
    private String currentArtist = "";
    private String currentTrack = "";
    private String currentAlbum = "";
    private boolean isPlaying = false;
    private Bitmap albumArtwork = null;

    // Display preferences
    private String displayMode = "reference"; // default display mode
    private boolean showControls = true;
    private boolean showAlbumArt = true;

    public MusicPlayerAugmentosAppService() {
        super();
    }

    @Override
    public void onCreate() {
        super.onCreate();
    }

    public void setup() {
        // Create AugmentOSLib instance
        augmentOSLib = new AugmentOSLib(this);

        // Initialize OkHttp client for API calls
        httpClient = new OkHttpClient();

        // Request various data streams
        augmentOSLib.requestTranscription("English");
        augmentOSLib.requestNotifications();

        // Try to request experimental features (will be ignored if not available)
        try {
            augmentOSLib.requestGlassesSideTaps();
        } catch (Exception e) {
            Log.d(TAG, "Glasses side taps not available: " + e.getMessage());
        }

        // Load settings
        loadSettings();

        // Attempt to load the Spotify token from preferences
        spotifyAccessToken = getSharedPreferences("SpotifyPrefs", MODE_PRIVATE)
                .getString("spotify_token", "");

        if (!spotifyAccessToken.isEmpty()) {
            // Start polling if we have a token
            startSpotifyPolling();
        } else {
            augmentOSLib.sendReferenceCard("Spotify Connection Needed",
                    "Please use the companion app to authenticate with Spotify");
        }
    }

    private void loadSettings() {
        // Load user preferences from AugmentOS settings
        try {
            // Get polling interval (in seconds, convert to ms)
            int pollSeconds = AugmentOSSettingsManager.getSliderSetting(this, "pollInterval");
            POLL_INTERVAL_MS = pollSeconds * 1000;

            // Get display mode
            displayMode = AugmentOSSettingsManager.getSelectSetting(this, "displayMode");

            // Get feature toggles
            showControls = AugmentOSSettingsManager.getBooleanSetting(this, "showControls");
            showAlbumArt = AugmentOSSettingsManager.getBooleanSetting(this, "showAlbumArt");
        } catch (Exception e) {
            Log.e(TAG, "Error loading settings: " + e.getMessage());
            // Use defaults if settings fail to load
        }
    }

    private void startSpotifyPolling() {
        // Cancel any existing timer
        if (spotifyCheckTimer != null) {
            spotifyCheckTimer.cancel();
        }

        // Create a new timer to poll Spotify API
        spotifyCheckTimer = new Timer();
        spotifyCheckTimer.scheduleAtFixedRate(new TimerTask() {
            @Override
            public void run() {
                fetchCurrentlyPlaying();
            }
        }, 0, POLL_INTERVAL_MS);
    }

    private void fetchCurrentlyPlaying() {
        Request request = new Request.Builder()
                .url("https://api.spotify.com/v1/me/player/currently-playing")
                .addHeader("Authorization", "Bearer " + spotifyAccessToken)
                .build();

        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                Log.e(TAG, "Failed to fetch currently playing track", e);
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (response.code() == 204) {
                    // Nothing is playing
                    if (!lastTrackId.isEmpty()) {
                        // Clear current track if we were previously playing
                        clearCurrentTrack();
                    }
                    return;
                }

                if (response.code() == 401) {
                    // Token expired
                    Log.e(TAG, "Spotify token expired");
                    augmentOSLib.sendReferenceCard("Spotify Authentication Needed",
                            "Your Spotify access has expired. Please reconnect via the companion app.");
                    spotifyCheckTimer.cancel();
                    return;
                }

                if (!response.isSuccessful()) {
                    Log.e(TAG, "Error response: " + response.code());
                    return;
                }

                try {
                    String responseBody = response.body().string();
                    JSONObject json = new JSONObject(responseBody);

                    // Update playing status
                    isPlaying = json.optBoolean("is_playing", false);

                    if (!json.has("item")) {
                        return;
                    }

                    JSONObject item = json.getJSONObject("item");
                    String trackId = item.getString("id");

                    // Check if the track has changed
                    boolean trackChanged = !trackId.equals(lastTrackId);
                    lastTrackId = trackId;

                    // Always update track info
                    currentTrack = item.getString("name");
                    currentAlbum = item.getJSONObject("album").getString("name");

                    // Get artist info
                    JSONArray artists = item.getJSONArray("artists");
                    StringBuilder artistsBuilder = new StringBuilder();
                    for (int i = 0; i < artists.length(); i++) {
                        if (i > 0) artistsBuilder.append(", ");
                        artistsBuilder.append(artists.getJSONObject(i).getString("name"));
                    }
                    currentArtist = artistsBuilder.toString();

                    // Get album art if track changed and it's enabled
                    if (trackChanged && showAlbumArt) {
                        JSONArray images = item.getJSONObject("album").getJSONArray("images");
                        if (images.length() > 0) {
                            // Get smallest image for faster loading
                            JSONObject image = images.getJSONObject(images.length() - 1);
                            String imageUrl = image.getString("url");
                            fetchAlbumArt(imageUrl);
                        }
                    }

                    // Display the information on the glasses
                    if (trackChanged) {
                        displayCurrentTrack();
                    }
                } catch (JSONException e) {
                    Log.e(TAG, "Failed to parse JSON", e);
                }
            }
        });
    }

    private void fetchAlbumArt(String imageUrl) {
        Request request = new Request.Builder()
                .url(imageUrl)
                .build();

        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                Log.e(TAG, "Failed to fetch album art", e);
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (!response.isSuccessful()) {
                    Log.e(TAG, "Error response for album art: " + response.code());
                    return;
                }

                InputStream inputStream = response.body().byteStream();
                albumArtwork = BitmapFactory.decodeStream(inputStream);

                // If the display mode supports images, redisplay with the image
                if (showAlbumArt) {
                    displayCurrentTrack();
                }
            }
        });
    }

    private void clearCurrentTrack() {
        lastTrackId = "";
        currentTrack = "";
        currentArtist = "";
        currentAlbum = "";
        isPlaying = false;
        albumArtwork = null;

        augmentOSLib.sendCenteredText("No music currently playing");
    }

    private void displayCurrentTrack() {
        String title = "Now Playing on Spotify";
        String content = currentTrack + "\nby " + currentArtist + "\non " + currentAlbum;
        String playbackStatus = isPlaying ? "▶️ Playing" : "⏸️ Paused";

        // Display based on chosen display style
        switch (displayMode) {
            case "reference":
                augmentOSLib.sendReferenceCard(title, content);
                break;

            case "bullets":
                augmentOSLib.sendBulletPointList(title, new String[] {
                        "Track: " + currentTrack,
                        "Artist: " + currentArtist,
                        "Album: " + currentAlbum,
                        playbackStatus
                });
                break;

            case "rows":
                augmentOSLib.sendRowsCard(new String[] {
                        "🎵 " + currentTrack,
                        "👤 " + currentArtist,
                        "💿 " + currentAlbum,
                        playbackStatus
                });
                break;

            case "double":
                augmentOSLib.sendDoubleTextWall(
                        title + "\n" + playbackStatus,
                        "Track: " + currentTrack + "\nArtist: " + currentArtist + "\nAlbum: " + currentAlbum
                );
                break;

            case "wall":
            default:
                augmentOSLib.sendTextWall(
                        title + "\n\n" +
                                "Track: " + currentTrack + "\n" +
                                "Artist: " + currentArtist + "\n" +
                                "Album: " + currentAlbum + "\n\n" +
                                playbackStatus
                );
                break;
        }

        // When album art support is added
        if (showAlbumArt && albumArtwork != null) {
            try {
                augmentOSLib.sendBitmap(albumArtwork);
            } catch (Exception e) {
                Log.e(TAG, "Failed to display album art: " + e.getMessage());
            }
        }

        // Show playback controls if enabled
        if (showControls) {
            displayControls();
        }
    }

    private void displayControls() {
        augmentOSLib.sendRowsCard(new String[] {
                "📢 Say 'previous track' to go back",
                "📢 Say 'pause music' to pause",
                "📢 Say 'play music' to play",
                "📢 Say 'next track' to skip"
        });
    }

    // Control Spotify playback
    private void controlPlayback(String action) {
        String endpoint;

        switch (action) {
            case "play":
                endpoint = "https://api.spotify.com/v1/me/player/play";
                break;
            case "pause":
                endpoint = "https://api.spotify.com/v1/me/player/pause";
                break;
            case "next":
                endpoint = "https://api.spotify.com/v1/me/player/next";
                break;
            case "previous":
                endpoint = "https://api.spotify.com/v1/me/player/previous";
                break;
            default:
                return;
        }

        Request request = new Request.Builder()
                .url(endpoint)
                .addHeader("Authorization", "Bearer " + spotifyAccessToken)
                .post(okhttp3.RequestBody.create(new byte[0], null))
                .build();

        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                Log.e(TAG, "Failed to control playback: " + e.getMessage());
                augmentOSLib.sendCenteredText("Failed to " + action + " playback");
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (response.isSuccessful() || response.code() == 204) {
                    // Wait briefly then fetch updated status
                    new Timer().schedule(new TimerTask() {
                        @Override
                        public void run() {
                            fetchCurrentlyPlaying();
                        }
                    }, 500);

                    augmentOSLib.sendCenteredText(action + " command sent");
                } else {
                    Log.e(TAG, "Failed to control playback: " + response.code());
                    augmentOSLib.sendCenteredText("Failed to " + action + " playback");
                }
            }
        });
    }

    // To get speech transcription, subscribe to them using EventBus
    @Subscribe
    public void onSpeechTranscriptionTranscript(SpeechRecOutputEvent event) {
        // We only care about final transcripts
        if (!event.isFinal) return;

        String text = event.text.toLowerCase();

        // Listen for voice commands to control Spotify
        if (text.contains("what's playing") || text.contains("what is playing") ||
                text.contains("what song is this")) {
            displayCurrentTrack();
        } else if (text.contains("play music") || text.contains("resume music")) {
            controlPlayback("play");
        } else if (text.contains("pause music") || text.contains("stop music")) {
            controlPlayback("pause");
        } else if (text.contains("next track") || text.contains("next song") ||
                text.contains("skip song") || text.contains("skip track")) {
            controlPlayback("next");
        } else if (text.contains("previous track") || text.contains("previous song") ||
                text.contains("last song") || text.contains("go back")) {
            controlPlayback("previous");
        } else if (text.contains("show controls") || text.contains("music controls")) {
            displayControls();
        }
    }

    // To receive Spotify notifications
    @Subscribe
    public void onNotificationEvent(NotificationEvent event) {
        // Check if this is a Spotify notification
        if (event.packageName != null && event.packageName.equals("com.spotify.music")) {
            // Refresh our current track info
            fetchCurrentlyPlaying();
        }
    }

    // Support for glasses side tap events
    @Subscribe
    public void onGlassesSideEvent(GlassesSideTapEvent event) {
        // Use side tap to toggle play/pause
        if (isPlaying) {
            controlPlayback("pause");
        } else {
            controlPlayback("play");
        }
        augmentOSLib.sendCenteredText("Toggling playback...");
    }

    // Method to update the token from our companion app
    public void updateSpotifyToken(String newToken) {
        // Save the token to preferences
        getSharedPreferences("SpotifyPrefs", MODE_PRIVATE)
                .edit()
                .putString("spotify_token", newToken)
                .apply();

        spotifyAccessToken = newToken;

        // Start or restart polling
        startSpotifyPolling();

        augmentOSLib.sendReferenceCard("Spotify Connected",
                "Successfully connected to your Spotify account!");
    }

    @Override
    public void onDestroy() {
        // Stop the timer when the service is destroyed
        if (spotifyCheckTimer != null) {
            spotifyCheckTimer.cancel();
        }

        // deInit your augmentOSLib instance onDestroy
        augmentOSLib.deinit();
        super.onDestroy();
    }
}
