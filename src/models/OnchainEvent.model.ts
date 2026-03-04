import mongoose, { Schema, Document } from "mongoose";

export interface IOnchainEvent extends Document {
  eventKey: string;
  webhookId?: string;
  webhookEventId?: string;
  chainId?: number;
  blockNumber?: number;
  txHash?: string;
  logIndex?: number;
  address?: string;
  topic0?: string;
  topics?: string[];
  data?: string;
  receivedAt: Date;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
}

const OnchainEventSchema = new Schema<IOnchainEvent>(
  {
    eventKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    webhookId: { type: String, index: true },
    webhookEventId: { type: String, index: true },
    chainId: { type: Number, index: true },
    blockNumber: { type: Number, index: true },
    txHash: { type: String, lowercase: true, index: true },
    logIndex: { type: Number, index: true },
    address: { type: String, lowercase: true, index: true },
    topic0: { type: String, lowercase: true, index: true },
    topics: { type: [String] },
    data: { type: String },
    receivedAt: { type: Date, default: Date.now, index: true },
    payload: { type: Schema.Types.Mixed, required: true },
  },
  {
    timestamps: true,
  }
);

OnchainEventSchema.index({ txHash: 1, logIndex: 1, topic0: 1 });
OnchainEventSchema.index({ webhookId: 1, webhookEventId: 1 });

export const OnchainEvent = mongoose.model<IOnchainEvent>(
  "OnchainEvent",
  OnchainEventSchema
);
