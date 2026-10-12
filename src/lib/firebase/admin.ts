import { getApps, initializeApp, cert, getApp, App } from "firebase-admin/app";
import { getAuth, Auth } from "firebase-admin/auth";
import { createLogger } from "../logger";

const log = createLogger("FirebaseAdmin");

const projectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
  "omnichannel-support-dev";

let adminApp: App;

if (getApps().length === 0) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      adminApp = initializeApp({
        credential: cert(serviceAccount),
        projectId,
      });
    } catch (e) {
      log.warn("Could not parse FIREBASE_SERVICE_ACCOUNT_KEY — initializing with projectId only", { err: e, projectId });
      adminApp = initializeApp({ projectId });
    }
  } else {
    adminApp = initializeApp({ projectId });
  }
} else {
  adminApp = getApp();
}

export const adminAuth: Auth = getAuth(adminApp);
export { adminApp };
