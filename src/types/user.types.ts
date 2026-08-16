export interface UserRegistrationData {
  walletAddress: string;
  /** Signature over the challenge this server issued for walletAddress. */
  signature: string;
  username?: string;
  surname: string;
  firstname: string;
  fullName?: string;
  email: string;
  phoneNumber?: string;
  avatar?: string;
}

export interface LoginData {
  walletAddress: string;
  /**
   * Signature only. The message is rebuilt server-side from the stored
   * challenge, so there is nothing for a caller to forge.
   */
  signature: string;
}
