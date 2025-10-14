export interface OrganizationData {
  name: string;
  contractAddress: string;
  creatorAddress: string;
  businessEmail: string;
  
  signers: { 
    address: string; 
    name: string;
    role: string;
  }[]
  
  quorum: number;
  
  businessInfo?: {
    registrationNumber?: string;
    registrationType?: string;
    certificate?: {
      fileUrl: string;
      fileName: string;
    };
  };
  
  metadata?: {
    industry?: string;
    size?: string;
    description?: string;
  };
}

export interface BatchPayrollData {
  batchName: string;
  organizationId: string;
  organizationAddress: string;
  creatorAddress: string;
  recipients: {
    walletAddress: string;
    amount: string;
  }[];
}
