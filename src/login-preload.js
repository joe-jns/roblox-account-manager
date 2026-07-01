// Runs in the Roblox login window. Roblox triggers a WebAuthn/passkey prompt
// (the Windows "Choose a passkey" dialog) on the login page. Neutralize the
// WebAuthn API so the page falls straight back to username/password.
try {
  const deny = () => Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
  if (navigator.credentials) {
    navigator.credentials.get = deny;
    navigator.credentials.create = deny;
  }
  if (window.PublicKeyCredential) {
    window.PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
    window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(false);
  }
} catch (e) {
  // best-effort
}
