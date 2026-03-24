const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

const normalizePrivateKey = (value = '') => String(value || '').replace(/\\n/g, '\n');

const loadServiceAccountFromEnv = () => {
  const rawJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson) {
    const parsed = JSON.parse(rawJson);
    if (parsed?.private_key) {
      parsed.private_key = normalizePrivateKey(parsed.private_key);
    }
    return parsed;
  }

  const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY || '');

  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: privateKey
    };
  }

  return null;
};

const loadServiceAccountFromPath = () => {
  const configuredPath = String(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
  if (!configuredPath) return null;

  const resolvedPath = path.resolve(configuredPath);
  const rawJson = fs.readFileSync(resolvedPath, 'utf8');
  const parsed = JSON.parse(rawJson);

  if (parsed?.private_key) {
    parsed.private_key = normalizePrivateKey(parsed.private_key);
  }

  return parsed;
};

const loadServiceAccount = () => {
  const fallbackPath = path.resolve(__dirname, '../service-account.json');

  if (!isProduction && fs.existsSync(fallbackPath)) {
    return require(fallbackPath);
  }

  const fromEnv = loadServiceAccountFromEnv();
  if (fromEnv) return fromEnv;
  const fromPath = loadServiceAccountFromPath();
  if (fromPath) return fromPath;
  if (fs.existsSync(fallbackPath)) {
    return require(fallbackPath);
  }

  throw new Error(
    'Firebase service account not found. Set FIREBASE_SERVICE_ACCOUNT_PATH or provide FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.'
  );
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount())
  });
}

module.exports = admin;
