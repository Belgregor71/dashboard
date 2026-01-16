// /api/spotify/now-playing.js

import express from "express";
import fetch from "node-fetch";

const router = express.Router();

// Load from environment variables
const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REFRESH_TOKEN
} = process.env;

async function getAccessToken() {
  const tokenUrl = "https://accounts.spotify.com/api/token";

  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", SPOTIFY_REFRESH_TOKEN);

  const authHeader = Buffer.from(
    `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authHeader}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  const data = await res.json();
  return data.access_token;
}

router.get("/now-playing", async (req, res) => {
  try {
    const accessToken = await getAccessToken();

    const nowPlayingUrl =
      "https://api.spotify.com/v1/me/player/currently-playing";

    const nowRes = await fetch(nowPlayingUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (nowRes.status === 204 || nowRes.status > 400) {
      return res.json({ isPlaying: false });
    }

    const data = await nowRes.json();

    if (!data || !data.item) {
      return res.json({ isPlaying: false });
    }

    const track = data.item.name;
    const artist = data.item.artists.map(a => a.name).join(", ");
    const albumArt = data.item.album.images[0]?.url || null;

    res.json({
      isPlaying: data.is_playing,
      track,
      artist,
      albumArt,
      progressMs: data.progress_ms,
      durationMs: data.item.duration_ms
    });
  } catch (err) {
    console.error("Spotify backend error:", err);
    res.json({ isPlaying: false });
  }
});

export default router;
