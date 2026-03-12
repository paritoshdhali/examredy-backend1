const admin = require('firebase-admin');

let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
      serviceAccount = require('../firebase-service-account.json');
  }
  
  if (serviceAccount) {
      admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
      });
  }
} catch (error) {
  console.error("Firebase Admin initialization error", error.stack);
}

module.exports = admin;
