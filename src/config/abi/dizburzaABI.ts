export const DIZBURZA_ABI = [
  "function createBatchPayroll(string batchName, address[] recipients, uint256[] amounts)",
  "function approveBatch(string batchName)",
  "function executeBatchPayroll(string batchName)",
  "function getBatchDetails(string batchName) view returns (string, address, address[], uint256[], bool, bool, uint256, uint256, uint256)",
  "event BatchCreated(string indexed batchName, address indexed creator, uint256 expiresAt)",
  "event BatchApproved(string indexed batchName, address indexed approver)",
  "event BatchExecuted(string indexed batchName, address executor, uint256 totalAmount)",
];