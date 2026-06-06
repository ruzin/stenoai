// Build-time configuration, read by app/main.js at startup.
//
// Copy this file to `build-config.js` and fill in your own values for
// local development. `build-config.js` is gitignored — never commit it.
//
// CI builds write this file directly from GitHub Actions secrets in
// .github/workflows/build-release.yml; this template is only for local
// dev runs (`npm start` / `npm run start:nobuild`).
//
// If you leave these blank, calendar integration is disabled but the
// rest of the app (recording, transcription, summarization) works
// normally.

module.exports = {
  // Google Calendar OAuth credentials. Get your own from
  // https://console.cloud.google.com → APIs & Services → Credentials.
  // Create an OAuth 2.0 Client ID of type "Desktop application".
  // Google treats Desktop-client secrets as public-by-policy; the
  // production value is held in the repo's GitHub Actions secrets.
  GOOGLE_OAUTH_CLIENT_ID: '',
  GOOGLE_OAUTH_CLIENT_SECRET: '',
};
