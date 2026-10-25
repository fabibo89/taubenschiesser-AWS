const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');
const logger = require('../utils/logger');

function s3Config() {
  const bucket = (process.env.DATASET_S3_BUCKET || '').trim();
  const region = process.env.AWS_REGION || process.env.DATASET_S3_REGION || 'eu-central-1';
  const prefix = (process.env.DATASET_S3_PREFIX || 'yolo-exports/').replace(/^\/+/, '');
  const expiresIn = Math.max(
    60,
    Number(process.env.DATASET_S3_URL_EXPIRES || 86400) || 86400
  );
  const publicBase = (process.env.DATASET_S3_PUBLIC_BASE || '').replace(/\/+$/, '');
  const autoUpload = String(process.env.DATASET_S3_AUTO_UPLOAD || '').toLowerCase() === 'true';
  return {
    enabled: Boolean(bucket),
    bucket,
    region,
    prefix: prefix.endsWith('/') ? prefix : `${prefix}/`,
    expiresIn,
    publicBase,
    autoUpload
  };
}

function isS3Configured() {
  return s3Config().enabled;
}

function createS3Client(cfg = s3Config()) {
  if (!cfg.enabled) return null;
  const options = { region: cfg.region };
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    options.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    options.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  }
  return new AWS.S3(options);
}

/**
 * Upload a local YOLO export zip to S3 and return a Colab-fetchable URL.
 * Prefers DATASET_S3_PUBLIC_BASE when set; otherwise a presigned GET URL.
 */
async function uploadZipForColab(zipPath, downloadName) {
  const cfg = s3Config();
  if (!cfg.enabled) {
    const err = new Error('DATASET_S3_BUCKET ist nicht konfiguriert');
    err.statusCode = 503;
    throw err;
  }
  if (!zipPath || !fs.existsSync(zipPath)) {
    const err = new Error('Export-ZIP nicht gefunden');
    err.statusCode = 404;
    throw err;
  }

  const safeName = path.basename(downloadName || path.basename(zipPath));
  const key = `${cfg.prefix}${safeName}`;
  const s3 = createS3Client(cfg);
  const body = fs.createReadStream(zipPath);

  logger.info(`Uploading Colab dataset to s3://${cfg.bucket}/${key}`);
  await s3
    .upload({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/zip',
      Metadata: {
        purpose: 'colab-yolo-export'
      }
    })
    .promise();

  let url;
  let urlType;
  if (cfg.publicBase) {
    url = `${cfg.publicBase}/${key}`;
    urlType = 'public';
  } else {
    url = s3.getSignedUrl('getObject', {
      Bucket: cfg.bucket,
      Key: key,
      Expires: cfg.expiresIn
    });
    urlType = 'presigned';
  }

  return {
    url,
    urlType,
    bucket: cfg.bucket,
    key,
    expiresIn: urlType === 'presigned' ? cfg.expiresIn : null,
    downloadName: safeName
  };
}

module.exports = {
  s3Config,
  isS3Configured,
  uploadZipForColab
};
