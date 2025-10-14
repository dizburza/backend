export interface UserRegistrationData {
  walletAddress: string;
  username: string;
  surname: string;
  firstname: string;
  fullName: string;
  email: string;
  phoneNumber?: string;
  role?: "employee" | "signer" | "admin";
}

export interface LoginData {
  walletAddress: string;
  signature: string;
  message: string;
}
