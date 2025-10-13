export const FACTORY_ABI = [
  "function createOrganization(string organizationHash, address[] signers, uint256 quorum) returns (address)",
  "function getOrganizationByCreator(address creator) view returns (address)",
  "event OrganizationCreated(address indexed organization, address indexed creator, string organizationHash, address[] signers, uint256 quorum, uint256 timestamp)",
];