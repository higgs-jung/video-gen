require("dotenv").config();
const path = require("path");

module.exports = {
  // API Keys
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  PEXELS_API_KEY: process.env.PEXELS_API_KEY,
  CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,

  // API Endpoints & Models
  CLAUDE_BASE_URL: "https://api.anthropic.com/v1/messages",
  CLAUDE_MODEL: "claude-sonnet-4-20250514",
  OPENAI_CHAT_URL: "https://api.openai.com/v1/chat/completions",
  OPENAI_SPEECH_URL: "https://api.openai.com/v1/audio/speech",
  OPENAI_MODEL: "gpt-4o-mini",
  PEXELS_VIDEO_SEARCH_URL: "https://api.pexels.com/videos/search",

  // File Paths
  LOGO_VIDEO_PATH: "logo.mp4",
  USED_VIDEOS_FILE: "used_videos.json",
  TEMP_DIR: path.join(__dirname, "temp"),

  // Video Formats
  VIDEO_FORMATS: {
    SHORTS: { width: 1080, height: 1920 }, // 세로 영상 (Shorts)
    LANDSCAPE: { width: 1920, height: 1080 }, // 가로 영상
  },

  // FFMPEG
  FFMPEG_PATH: require("ffmpeg-static"),
  FFPROBE_PATH: require("@ffprobe-installer/ffprobe").path,
};
