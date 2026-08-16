/**
 * DizburzaCashLink, the send-by-link escrow.
 *
 * `claim` and `reclaim` take no sender check, so this process calls them
 * directly with the relayer key. `create` and `cancel` read `_msgSender()` and
 * so are relayed as ERC-2771 requests the user signed.
 */
export const CASH_LINK_ABI = [
  {
    type: "function",
    name: "create",
    stateMutability: "nonpayable",
    inputs: [
      { name: "claimAddress", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "fee", type: "uint256" },
      { name: "window", type: "uint48" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "claimAddress", type: "address" },
      { name: "recipient", type: "address" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancel",
    stateMutability: "nonpayable",
    inputs: [{ name: "claimAddress", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "reclaim",
    stateMutability: "nonpayable",
    inputs: [{ name: "claimAddress", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getLink",
    stateMutability: "view",
    inputs: [{ name: "claimAddress", type: "address" }],
    outputs: [
      { name: "sender", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "expiresAt", type: "uint48" },
      { name: "status", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [{ name: "claimAddress", type: "address" }],
    outputs: [
      { name: "ok", type: "bool" },
      { name: "amount", type: "uint256" },
      { name: "expiresAt", type: "uint48" },
    ],
  },
  {
    type: "function",
    name: "claimDomainSeparator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  { type: "function", name: "MIN_WINDOW", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint48" }] },
  { type: "function", name: "MAX_WINDOW", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint48" }] },
  {
    type: "event",
    name: "LinkCreated",
    inputs: [
      { name: "claimAddress", type: "address", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
      { name: "expiresAt", type: "uint48", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LinkClaimed",
    inputs: [
      { name: "claimAddress", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LinkCancelled",
    inputs: [
      { name: "claimAddress", type: "address", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LinkReclaimed",
    inputs: [
      { name: "claimAddress", type: "address", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  { type: "error", name: "InvalidClaimAddress", inputs: [] },
  { type: "error", name: "LinkAlreadyExists", inputs: [] },
  { type: "error", name: "LinkNotOpen", inputs: [] },
  { type: "error", name: "LinkExpired", inputs: [] },
  { type: "error", name: "LinkNotExpired", inputs: [] },
  { type: "error", name: "InvalidAmount", inputs: [] },
  { type: "error", name: "InvalidWindow", inputs: [] },
  { type: "error", name: "InvalidRecipient", inputs: [] },
  { type: "error", name: "InvalidClaimSignature", inputs: [] },
  { type: "error", name: "NotLinkSender", inputs: [] },
] as const;
