import { Request, Response } from "express";
import { asyncHandler, AppError } from "../middlewares/errorHandler.middleware.js";
import { ENV } from "../config/environment.js";
import { isValidAlchemySignatureForStringBody } from "../utils/alchemySignature.util.js";
import connectDB from "../config/database.js";
import { OnchainEvent } from "../models/OnchainEvent.model.js";
import { BankingService } from "../services/banking.service.js";
import { Organization } from "../models/Organization.model.js";
import { User } from "../models/User.model.js";

type ParsedLog = {
  address?: string;
  topics?: string[];
  topic0?: string;
  data?: string;
  txHash?: string;
  logIndex?: number;
  blockNumber?: number;
};

const toParsedLog = (params: {
  address?: string;
  topics?: unknown;
  data?: string;
  txHash?: string;
  logIndex?: unknown;
  blockNumber?: number;
}): ParsedLog => {
  const topics = Array.isArray(params.topics) ? (params.topics as string[]) : undefined;
  const topic0 = topics?.[0];
  const logIndex = typeof params.logIndex === "number" ? params.logIndex : undefined;

  return {
    address: params.address,
    topics,
    topic0,
    data: params.data,
    txHash: params.txHash,
    logIndex,
    blockNumber: params.blockNumber,
  };
};

const parseDirectLogItem = (item: any, blockNumber?: number): ParsedLog | null => {
  const txHash = item?.transaction?.hash;
  if (!txHash) return null;

  const looksLikeLog = Boolean(item?.account?.address || item?.data || item?.topics);
  if (!looksLikeLog) return null;

  return toParsedLog({
    address: item?.account?.address,
    topics: item?.topics,
    data: item?.data,
    txHash,
    logIndex: item?.index,
    blockNumber,
  });
};

const parseNestedTransactionLogs = (item: any, blockNumber?: number): ParsedLog[] => {
  const txHash = item?.transaction?.hash;
  const nestedLogs = item?.transaction?.logs;
  if (!txHash || !Array.isArray(nestedLogs)) return [];

  return nestedLogs.map((l: any) =>
    toParsedLog({
      address: l?.account?.address,
      topics: l?.topics,
      data: l?.data,
      txHash,
      logIndex: l?.index,
      blockNumber,
    }),
  );
};

const extractLogsFromAlchemyPayload = (payload: any): ParsedLog[] => {
  const topLevelLogs = payload?.event?.data?.block?.logs;
  const blockNumber = payload?.event?.data?.block?.number;

  if (!Array.isArray(topLevelLogs)) return [];

  return topLevelLogs.flatMap((item: any) => {
    // Custom webhook queries often return logs directly (each log already contains transaction.hash).
    // Older shapes may return a transaction object that contains nested logs.
    const direct = parseDirectLogItem(item, blockNumber);
    if (direct) return [direct];
    return parseNestedTransactionLogs(item, blockNumber);
  });
};

const normalizeHex = (v?: string) => (typeof v === "string" ? v.toLowerCase() : v);

const TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const topicToAddress = (topic: string | undefined): string | undefined => {
  if (!topic || typeof topic !== "string") return undefined;
  // indexed address topic is 32 bytes, last 20 bytes are address
  if (!topic.startsWith("0x") || topic.length !== 66) return undefined;
  return `0x${topic.slice(26)}`.toLowerCase();
};

const storeOnchainEvent = async (params: {
  payload: any;
  webhookId?: string;
  webhookEventId?: string;
  txHash?: string;
  logIndex?: number;
  blockNumber?: number;
  address?: string;
  topic0?: string;
  topics?: string[];
  data?: string;
}) => {
  const { payload, webhookId, webhookEventId } = params;
  const txHash = normalizeHex(params.txHash);
  const logIndex = params.logIndex;
  const address = normalizeHex(params.address);
  const topic0 = normalizeHex(params.topic0);

  const eventKey = `${ENV.CHAIN_ID}:${txHash || "noTx"}:${logIndex ?? -1}:${topic0 || "noTopic"}`;

  try {
    await OnchainEvent.create({
      eventKey,
      webhookId,
      webhookEventId,
      chainId: ENV.CHAIN_ID,
      blockNumber: params.blockNumber,
      txHash,
      logIndex,
      address,
      topic0,
      topics: params.topics?.map((t) => t.toLowerCase()),
      data: params.data,
      receivedAt: new Date(),
      payload,
    });
    return { stored: true };
  } catch (e: any) {
    if (e?.code === 11000) return { stored: false };
    throw e;
  }
};

const recordCngnTransferIfRelevant = async (log: ParsedLog) => {
  const topic0 = normalizeHex(log.topic0);
  const address = normalizeHex(log.address);

  if (topic0 !== TRANSFER_TOPIC0) return { recorded: false };
  if (!address || address !== ENV.cNGN_ADDRESS.toLowerCase()) return { recorded: false };

  const txHash = normalizeHex(log.txHash);
  if (!txHash) return { recorded: false };

  const from = topicToAddress(log.topics?.[1]);
  const to = topicToAddress(log.topics?.[2]);
  if (!from || !to) return { recorded: false };

  const valueHex = log.data;
  if (!valueHex || typeof valueHex !== "string" || !valueHex.startsWith("0x")) {
    return { recorded: false };
  }

  const amount = BigInt(valueHex).toString();

  const [fromUser, toUser, org] = await Promise.all([
    User.findOne({ walletAddress: from.toLowerCase() }),
    User.findOne({ walletAddress: to.toLowerCase() }),
    Organization.findOne({ contractAddress: from.toLowerCase() }),
  ]);

  // Always record cNGN transfers so history-by-address remains accurate even if
  // the DB was wiped and user/org records are temporarily missing.

  let type: "send" | "receive" | "payroll";
  if (org) {
    type = "payroll";
  } else if (fromUser) {
    type = "send";
  } else {
    type = toUser ? "receive" : "send";
  }

  await BankingService.recordTransaction({
    txHash,
    logIndex: log.logIndex,
    type,
    fromAddress: from,
    toAddress: to,
    amount,
    blockNumber: log.blockNumber,
    organizationId: org ? String(org._id) : undefined,
  });

  return { recorded: true };
};

export const alchemyWebhook = asyncHandler(async (req: Request, res: Response) => {
  await connectDB();

  const signature = req.get("X-Alchemy-Signature") || undefined;
  const signingKey = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY;

  const rawBody = (req as any).rawBody as string | undefined;
  if (!rawBody) throw new AppError("Missing raw body", 400);

  const valid = isValidAlchemySignatureForStringBody(rawBody, signature, signingKey);
  if (!valid) throw new AppError("Invalid webhook signature", 401);

  const payload = req.body;
  const webhookId = payload?.webhookId;
  const webhookEventId = payload?.id;

  const logs = extractLogsFromAlchemyPayload(payload);

  const ingested: { stored: number; transfersRecorded: number; ignored: number } = {
    stored: 0,
    transfersRecorded: 0,
    ignored: 0,
  };

  for (const log of logs) {
    const { stored } = await storeOnchainEvent({
      payload,
      webhookId,
      webhookEventId,
      txHash: log.txHash,
      logIndex: log.logIndex,
      blockNumber: log.blockNumber,
      address: log.address,
      topic0: log.topic0,
      topics: log.topics,
      data: log.data,
    });

    if (stored) ingested.stored++;

    const { recorded } = await recordCngnTransferIfRelevant(log);
    if (recorded) {
      ingested.transfersRecorded++;
    } else {
      ingested.ignored++;
    }
  }

  res.json({ success: true, ...ingested });
});
