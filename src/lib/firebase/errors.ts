export function getFirebaseAuthErrorMessage(error: any): string {
  if (!error) return 'An unexpected error occurred. Please try again.';

  const code = error.code || '';

  switch (code) {
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-disabled':
      return 'This user account has been disabled.';
    case 'auth/user-not-found':
      return 'No account found with this email. Please check or sign up.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Incorrect email or password. Please try again.';
    case 'auth/email-already-in-use':
      return 'An account already exists with this email address.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters long.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in popup was closed before completing.';
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was cancelled.';
    case 'auth/popup-blocked':
      return 'Popup was blocked by your browser. Please allow popups for this site.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled in Firebase Console.';
    case 'auth/too-many-requests':
      return 'Too many unsuccessful attempts. Please try again later.';
    case 'auth/network-request-failed':
      return 'Network connection failed. Please check your internet connection.';
    case 'auth/missing-password':
      return 'Please enter your password.';
    case 'auth/user-token-expired':
    case 'auth/id-token-expired':
    case 'auth/requires-recent-login':
      return 'Your session has expired. Please sign in again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for sign-in. Add it in the Firebase Console (Authentication → Settings).';
    case 'auth/internal-error':
      return 'The sign-in service had a problem. Please try again.';
    case 'auth/api-key-not-valid.':
    case 'auth/invalid-api-key':
      return 'Firebase API key is not configured. Please add your credentials in .env.local.';
    default:
      // Don't show raw SDK messages like "Firebase: Error (auth/xyz)." to users
      return 'Authentication failed. Please try again.';
  }
}
