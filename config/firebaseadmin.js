// // config/firebaseadmin.js
// import admin from 'firebase-admin';
// import fs from 'fs';
// import path from 'path';
// import { fileURLToPath } from 'url';

// // Get __dirname in ES Modules
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// // Read the service account JSON manually
// const serviceAccount = JSON.parse(
//   fs.readFileSync(path.join(__dirname, 'parenteye.adminsdk.json'), 'utf-8')
// );

// // Initialize Firebase Admin
// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });

// console.log("✅ Firebase Admin initialized successfully Pavan.");

// export default admin;



import admin from 'firebase-admin';

let firebaseInitialized = false;

try { 
  if (!process.env.FIREBASE_CONFIG) {
    console.warn('⚠️  FIREBASE_CONFIG not found in environment variables. Firebase Admin not initialized.');
  } else {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

    // Fix newline characters in private key
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    firebaseInitialized = true;
    console.log('✅ Firebase Admin initialized from ENV');
  }
} catch (error) {
  console.error('❌ Firebase Admin initialization failed:', error.message);
}

export default firebaseInitialized ? admin : null;
