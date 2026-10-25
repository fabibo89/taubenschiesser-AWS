const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const logger = require('../utils/logger');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * Extract a Google Drive folder ID from a folder URL or raw ID.
 */
function parseDriveFolderId(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;
  const folderMatch = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  const idMatch = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s)) return s;
  return null;
}

function loadCredentials() {
  const raw = (process.env.GOOGLE_DRIVE_CREDENTIALS_JSON || '').trim();
  if (!raw) return null;
  try {
    if (raw.startsWith('{')) {
      return JSON.parse(raw);
    }
    const resolved = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
    if (!fs.existsSync(resolved)) {
      logger.warn(`GOOGLE_DRIVE_CREDENTIALS_JSON path not found: ${resolved}`);
      return null;
    }
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (err) {
    logger.warn(`Failed to load Google Drive credentials: ${err.message}`);
    return null;
  }
}

function driveConfig() {
  const credentials = loadCredentials();
  const folderId = parseDriveFolderId(process.env.GOOGLE_DRIVE_FOLDER_ID || '')
    || parseDriveFolderId(process.env.GOOGLE_DRIVE_FOLDER_URL || '');
  const clientEmail = (credentials?.client_email
    || process.env.GOOGLE_DRIVE_CLIENT_EMAIL
    || '').trim() || null;
  const colabPathPrefix = (process.env.GOOGLE_DRIVE_COLAB_PATH_PREFIX
    || '/content/drive/MyDrive/taubenschiesser').replace(/\/+$/, '');
  const autoUpload = String(process.env.GOOGLE_DRIVE_AUTO_UPLOAD || '').toLowerCase() === 'true';
  return {
    enabled: Boolean(credentials && folderId),
    credentialsReady: Boolean(credentials),
    folderId,
    clientEmail,
    colabPathPrefix,
    autoUpload
  };
}

function isDriveConfigured() {
  return driveConfig().enabled;
}

function createDriveClient(credentials) {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [DRIVE_SCOPE]
  });
  return google.drive({ version: 'v3', auth });
}

/**
 * Upload a local YOLO export zip into a Drive folder shared with the service account.
 * @param {string} zipPath
 * @param {string} downloadName
 * @param {{ folderId?: string, folderUrl?: string }} [options]
 */
async function uploadZipToDrive(zipPath, downloadName, options = {}) {
  const cfg = driveConfig();
  const credentials = loadCredentials();
  if (!credentials) {
    const err = new Error(
      'Google Drive Credentials fehlen (GOOGLE_DRIVE_CREDENTIALS_JSON in server/.env)'
    );
    err.statusCode = 503;
    throw err;
  }

  const folderId = parseDriveFolderId(options.folderId || '')
    || parseDriveFolderId(options.folderUrl || '')
    || cfg.folderId;
  if (!folderId) {
    const err = new Error(
      'Kein Drive-Ordner: GOOGLE_DRIVE_FOLDER_ID setzen oder Ordner-Link im Request senden'
    );
    err.statusCode = 400;
    throw err;
  }

  if (!zipPath || !fs.existsSync(zipPath)) {
    const err = new Error('Export-ZIP nicht gefunden');
    err.statusCode = 404;
    throw err;
  }

  const safeName = path.basename(downloadName || path.basename(zipPath));
  const drive = createDriveClient(credentials);

  logger.info(`Uploading dataset to Google Drive folder ${folderId} as ${safeName}`);

  const response = await drive.files.create({
    requestBody: {
      name: safeName,
      parents: [folderId]
    },
    media: {
      mimeType: 'application/zip',
      body: fs.createReadStream(zipPath)
    },
    fields: 'id, name, webViewLink, webContentLink',
    supportsAllDrives: true
  });

  const file = response.data || {};
  const colabPath = `${cfg.colabPathPrefix}/${safeName}`;

  return {
    fileId: file.id || null,
    name: file.name || safeName,
    webViewLink: file.webViewLink || (file.id
      ? `https://drive.google.com/file/d/${file.id}/view`
      : null),
    webContentLink: file.webContentLink || null,
    folderId,
    colabPath,
    downloadName: safeName,
    clientEmail: cfg.clientEmail
  };
}

module.exports = {
  parseDriveFolderId,
  driveConfig,
  isDriveConfigured,
  uploadZipToDrive
};
