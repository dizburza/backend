import { ethers } from "ethers";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { cashLinks } from "../db/schema.js";
import { ENV } from "../config/environment.js";
import { provider, tokenContract } from "../config/blockchain.js";
import { CASH_LINK_ABI } from "../config/abi/cashLinkABI.js";
import { AppError } from "../middlewares/errorHandler.middleware.js";
import { RelayerService } from "./relayer.service.js";
import { TokenService } from "./token.service.js";
import { FxService } from "./fx.service.js";
import { eventHub } from "./events.service.js";
import { isUniqueViolation } from "../utils/pgError.util.js";
import { withDbRetry } from "../utils/dbRetry.util.js";
import logger from "../utils/logger.util.js";

const cashLinkInterface = new ethers.Interface(CASH_LINK_ABI as never);

/** Mirrors the contract's enum. */
const enum OnChainStatus {
  None = 0,
  Open = 1,
  Claimed = 2,
  Cancelled = 3,
  Reclaimed = 4,
}

export type PublicLink = {
  claimAddress: string;
  amount: string;
  amountFormatted: string;
  symbol: string;
  expiresAt: Date;
  state: "claimable" | "claiming" | "settled" | "expired";
};

export type SenderLink = {
  id: string;
  claimAddress: string;
  amount: string;
  amountFormatted: string;
  feeAmount: string;
  feeFormatted: string;
  description: string | null;
  status: string;
  expiresAt: Date;
  claimedByAddress: string | null;
  createTxHash: string | null;
  settleTxHash: string | null;
  createdAt: Date;
  settledAt: Date | null;
};

/**
 * Send by link.
 *
 * The escrow contract holds the money and settles it. This service holds what
 * the escrow cannot: the sender's narration, the Dizburza account a link was
 * claimed into, and the short lease that stops two people racing one link.
 *
 * Two things are deliberately absent. Nothing here can move funds, because
 * every path ends in a contract call whose authority is already on chain. And
 * no claim secret is stored, because the link's private key lives in the URL
 * fragment and nowhere else.
 */
export class CashLinkService {
  static get enabled(): boolean {
    return Boolean(ENV.CASHLINK_ADDRESS) && RelayerService.enabled;
  }

  private static contract(): ethers.Contract {
    if (!ENV.CASHLINK_ADDRESS) {
      throw new AppError("Send by link is not configured", 503);
    }
    return new ethers.Contract(ENV.CASHLINK_ADDRESS, CASH_LINK_ABI as never, provider);
  }

  /**
   * What a link costs beyond the amount.
   *
   * Three transactions get sponsored per link: making it, settling it, and the
   * refund if nobody claims. All three are charged now, because a refunded link
   * leaves nothing to charge against afterwards and the refund itself costs gas.
   */
  static async quote(
    amount: bigint,
    walletAddress: string
  ): Promise<{
    amount: string;
    fee: string;
    total: string;
    amountFormatted: string;
    feeFormatted: string;
    totalFormatted: string;
    symbol: string;
    decimals: number;
    windowSeconds: number;
    needsApproval: boolean;
  }> {
    if (amount <= 0n) throw new AppError("Amount must be greater than zero", 400);
    if (!ENV.CASHLINK_ADDRESS) throw new AppError("Send by link is not configured", 503);

    const token = await TokenService.getDefault();
    const fee = await CashLinkService.feeInTokenUnits(token.decimals);
    const total = amount + fee;

    // The escrow pulls the tokens, so it needs an allowance first. Answered here
    // rather than read by the browser, which makes no RPC calls.
    const allowance = (await tokenContract.allowance(
      walletAddress,
      ENV.CASHLINK_ADDRESS
    )) as bigint;

    return {
      amount: amount.toString(),
      fee: fee.toString(),
      total: total.toString(),
      amountFormatted: ethers.formatUnits(amount, token.decimals),
      feeFormatted: ethers.formatUnits(fee, token.decimals),
      totalFormatted: ethers.formatUnits(total, token.decimals),
      symbol: token.symbol,
      decimals: token.decimals,
      windowSeconds: ENV.CASHLINK_WINDOW_SECONDS,
      needsApproval: allowance < total,
    };
  }

  /**
   * What it actually costs to sponsor this link, in cNGN.
   *
   * Three real inputs: the gas a create, claim and reclaim cycle burns, the
   * current gas price, and the current ETH/NGN rate. The rate comes from
   * `FxService` rather than a configured constant, which is the whole point: the
   * constant this replaced said ETH was worth six million naira when the market
   * said two and a half, so every fee derived from it was more than double what
   * it should have been.
   *
   * Two shaping steps on top, and both are pricing rather than measurement:
   * a margin, because the rate moves between quoting and settling and the
   * paymaster takes a cut, and rounding up to a readable figure, because a
   * quote of "N7.34" is a meter reading and not a price.
   */
  private static async feeInTokenUnits(decimals: number): Promise<bigint> {
    const SPONSORED_GAS = 420_000n;

    const [feeData, fx] = await Promise.all([
      provider.getFeeData(),
      FxService.ngnPerEth(),
    ]);

    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    const wei = SPONSORED_GAS * gasPrice;

    // Scaled to an integer so the rate never enters the arithmetic as a float.
    const rateScaled = BigInt(Math.round(fx.ngnPerEth * 100));
    const scale = 10n ** BigInt(decimals);
    const costMinor = (wei * rateScaled * scale) / (100n * 10n ** 18n);

    const withMargin =
      (costMinor * BigInt(100 + ENV.CASHLINK_FEE_MARGIN_PERCENT)) / 100n;

    return CashLinkService.roundFee(withMargin, scale);
  }

  /** Up to the next readable multiple, and never below the floor. */
  private static roundFee(minor: bigint, scale: bigint): bigint {
    const floor = BigInt(ENV.CASHLINK_FEE_MIN_NGN) * scale;
    const step = BigInt(Math.max(1, ENV.CASHLINK_FEE_ROUNDING_NGN)) * scale;

    const rounded = ((minor + step - 1n) / step) * step;
    return rounded < floor ? floor : rounded;
  }

  /**
   * Record a link the sender has already created on chain.
   *
   * The contract call comes first and this follows, so a row can only ever
   * describe escrow that exists. The chain is read back rather than trusted from
   * the request: the amount and expiry shown to a claimer have to be the ones
   * the escrow will actually pay.
   */
  static async record(input: {
    claimAddress: string;
    txHash: string;
    description?: string | null;
    sender: { userId: string; walletAddress: string };
  }): Promise<SenderLink> {
    const claimAddress = ethers.getAddress(input.claimAddress).toLowerCase();

    const [onChainSender, amount, expiresAt, status] = (await CashLinkService.contract()
      .getLink(claimAddress)) as [string, bigint, bigint, bigint];

    if (Number(status) === OnChainStatus.None) {
      throw new AppError("No link exists at that address yet", 404);
    }

    if (onChainSender.toLowerCase() !== input.sender.walletAddress.toLowerCase()) {
      throw new AppError("That link was created by someone else", 403);
    }

    const token = await TokenService.getDefault();

    try {
      const [row] = await db
        .insert(cashLinks)
        .values({
          claimAddress,
          senderAddress: input.sender.walletAddress.toLowerCase(),
          senderUserId: input.sender.userId,
          amount: amount.toString(),
          tokenId: token.id,
          description: input.description?.trim() || null,
          expiresAt: new Date(Number(expiresAt) * 1000),
          createTxHash: input.txHash,
          status: CashLinkService.toRowStatus(Number(status)),
        })
        .returning();

      return CashLinkService.toSenderLink(row, token);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("That link is already recorded", 409);
      }
      throw error;
    }
  }

  /**
   * What the claim page may show before anyone has signed in.
   *
   * Amount and expiry, and nothing else. Not the sender, not their name, not the
   * description. The link is bearer, so this answers to whoever holds it, and
   * everything withheld here is withheld for the reason in "Looking people up".
   */
  static async publicView(claimAddressRaw: string): Promise<PublicLink> {
    const claimAddress = ethers.getAddress(claimAddressRaw).toLowerCase();
    const token = await TokenService.getDefault();

    const [row] = await db
      .select()
      .from(cashLinks)
      .where(eq(cashLinks.claimAddress, claimAddress))
      .limit(1);

    // A link created while this service was down still has to be claimable, so
    // the chain answers when there is no row.
    if (!row) {
      let ok = false;
      let amount = 0n;
      let expiresAt = 0n;

      try {
        [ok, amount, expiresAt] = (await CashLinkService.contract().claimable(
          claimAddress
        )) as [boolean, bigint, bigint];
      } catch {
        // Unreachable escrow, or none configured. This route answers whoever
        // holds the link, so an unconfirmable link is one that does not exist.
        throw new AppError("This link does not exist", 404);
      }

      if (amount === 0n) throw new AppError("This link does not exist", 404);

      return {
        claimAddress,
        amount: amount.toString(),
        amountFormatted: ethers.formatUnits(amount, token.decimals),
        symbol: token.symbol,
        expiresAt: new Date(Number(expiresAt) * 1000),
        state: ok ? "claimable" : "expired",
      };
    }

    return {
      claimAddress,
      amount: row.amount,
      amountFormatted: ethers.formatUnits(BigInt(row.amount), token.decimals),
      symbol: token.symbol,
      expiresAt: row.expiresAt,
      state: CashLinkService.stateOf(row),
    };
  }

  private static stateOf(row: typeof cashLinks.$inferSelect): PublicLink["state"] {
    if (row.status !== "open" && row.status !== "claiming") return "settled";
    if (row.expiresAt.getTime() <= Date.now()) return "expired";

    const leased = row.claimingUntil && row.claimingUntil.getTime() > Date.now();
    return leased ? "claiming" : "claimable";
  }

  /**
   * Pay a link out to the caller.
   *
   * The recipient is the session's own wallet and never a value from the
   * request. On chain a claim can pay anyone the link's key signed for, so this
   * is the gate that keeps funds landing in a registered account, which is what
   * keeps customer due diligence intact for a bearer instrument.
   */
  static async claim(
    claimAddressRaw: string,
    signature: string,
    claimer: { userId: string; walletAddress: string }
  ): Promise<{ txHash: string }> {
    if (!CashLinkService.enabled) {
      throw new AppError("Send by link is not configured", 503);
    }

    const claimAddress = ethers.getAddress(claimAddressRaw).toLowerCase();
    const recipient = ethers.getAddress(claimer.walletAddress);

    const leased = await CashLinkService.takeLease(claimAddress);
    if (!leased) {
      throw new AppError("Someone is already claiming this link", 409);
    }

    const data = cashLinkInterface.encodeFunctionData("claim", [
      claimAddress,
      recipient,
      signature,
    ]);

    try {
      // Simulated first, so a bad signature or a link someone else already took
      // is a clean refusal rather than a wasted transaction.
      await provider.call({ to: ENV.CASHLINK_ADDRESS, data });

      const tx = await RelayerService.sendDirect({
        to: ENV.CASHLINK_ADDRESS,
        data,
        gasLimit: 200_000n,
        functionName: "cashLink.claim",
        fromAddress: recipient,
        userId: claimer.userId,
      });

      await db
        .update(cashLinks)
        .set({
          status: "claimed",
          claimedByAddress: recipient.toLowerCase(),
          claimedByUserId: claimer.userId,
          settleTxHash: tx.hash,
          settledAt: new Date(),
          claimingUntil: null,
        })
        .where(eq(cashLinks.claimAddress, claimAddress));

      await CashLinkService.announce(claimAddress);

      return { txHash: tx.hash };
    } catch (error) {
      await CashLinkService.releaseLease(claimAddress);

      const reason = CashLinkService.decodeRevert(error);
      if (reason) throw new AppError(CashLinkService.explain(reason), 400);
      throw error;
    }
  }

  /**
   * Claim the link, or do not run at all.
   *
   * One statement, so two browsers opening the same link cannot both come away
   * believing they hold it. The lease also has to expire on its own: a claim
   * that dies between here and the chain must not strand the link until it does.
   */
  private static async takeLease(claimAddress: string): Promise<boolean> {
    const until = new Date(Date.now() + ENV.CASHLINK_CLAIM_LEASE_SECONDS * 1000);

    const updated = await db
      .update(cashLinks)
      .set({ status: "claiming", claimingUntil: until })
      .where(
        and(
          eq(cashLinks.claimAddress, claimAddress),
          inArray(cashLinks.status, ["open", "claiming"]),
          sql`${cashLinks.expiresAt} > now()`,
          or(eq(cashLinks.status, "open"), lt(cashLinks.claimingUntil, new Date()))
        )
      )
      .returning({ id: cashLinks.id });

    // No row at all means the link was made while this service was down. The
    // contract still refuses a second claim, so let it through.
    if (updated.length > 0) return true;

    const [existing] = await db
      .select({ id: cashLinks.id })
      .from(cashLinks)
      .where(eq(cashLinks.claimAddress, claimAddress))
      .limit(1);

    return !existing;
  }

  private static async releaseLease(claimAddress: string): Promise<void> {
    await db
      .update(cashLinks)
      .set({ status: "open", claimingUntil: null })
      .where(
        and(eq(cashLinks.claimAddress, claimAddress), eq(cashLinks.status, "claiming"))
      );
  }

  /** Record a cancel the sender has already made on chain. */
  static async markCancelled(
    claimAddressRaw: string,
    txHash: string,
    sender: { walletAddress: string }
  ): Promise<void> {
    const claimAddress = ethers.getAddress(claimAddressRaw).toLowerCase();

    await db
      .update(cashLinks)
      .set({ status: "cancelled", settleTxHash: txHash, settledAt: new Date(), claimingUntil: null })
      .where(
        and(
          eq(cashLinks.claimAddress, claimAddress),
          eq(cashLinks.senderAddress, sender.walletAddress.toLowerCase())
        )
      );

    await CashLinkService.announce(claimAddress);
  }

  /** The sender's own links, description included. */
  static async listForSender(walletAddress: string, limit = 50): Promise<SenderLink[]> {
    const token = await TokenService.getDefault();

    const rows = await db
      .select()
      .from(cashLinks)
      .where(eq(cashLinks.senderAddress, walletAddress.toLowerCase()))
      .orderBy(desc(cashLinks.createdAt))
      .limit(Math.min(limit, 100));

    return rows.map((row) => CashLinkService.toSenderLink(row, token));
  }

  /**
   * Return lapsed links to their senders.
   *
   * The EVM has no timers, so a refund only feels automatic because something
   * sends the transaction. `reclaim` needs no privilege and can only pay the
   * sender, so this being a Dizburza process is a convenience rather than a
   * trust assumption: if it stops, refunds are late, not lost.
   */
  static async sweepExpired(batchSize = 25): Promise<number> {
    if (!CashLinkService.enabled) return 0;

    // Cheap, and this is the loop that spends the key, so it is where noticing
    // an empty one belongs.
    void RelayerService.warnIfLow();

    const due = await withDbRetry(
      () =>
        db
          .select({ claimAddress: cashLinks.claimAddress, senderAddress: cashLinks.senderAddress })
          .from(cashLinks)
          .where(
            and(
              inArray(cashLinks.status, ["open", "claiming"]),
              sql`${cashLinks.expiresAt} <= now()`
            )
          )
          .limit(batchSize),
      { label: "expired cash link sweep" }
    );

    let swept = 0;

    for (const link of due) {
      try {
        // The chain decides, not the row. A link claimed outside this service
        // would otherwise cost a reverting transaction on every sweep.
        const [, , , status] = (await CashLinkService.contract().getLink(
          link.claimAddress
        )) as [string, bigint, bigint, bigint];

        if (Number(status) !== OnChainStatus.Open) {
          await CashLinkService.reconcile(link.claimAddress, Number(status));
          continue;
        }

        const tx = await RelayerService.sendDirect({
          to: ENV.CASHLINK_ADDRESS,
          data: cashLinkInterface.encodeFunctionData("reclaim", [link.claimAddress]),
          gasLimit: 150_000n,
          functionName: "cashLink.reclaim",
          fromAddress: link.senderAddress,
        });

        await db
          .update(cashLinks)
          .set({
            status: "reclaimed",
            settleTxHash: tx.hash,
            settledAt: new Date(),
            claimingUntil: null,
          })
          .where(eq(cashLinks.claimAddress, link.claimAddress));

        await CashLinkService.announce(link.claimAddress);
        swept += 1;
      } catch (error) {
        logger.warn(`CashLink reclaim failed for ${link.claimAddress}:`, error);
      }
    }

    return swept;
  }

  /** Bring a row back in line with a chain that settled without us. */
  private static async reconcile(claimAddress: string, status: number): Promise<void> {
    await db
      .update(cashLinks)
      .set({
        status: CashLinkService.toRowStatus(status),
        settledAt: new Date(),
        claimingUntil: null,
      })
      .where(eq(cashLinks.claimAddress, claimAddress));
  }

  private static toRowStatus(status: number): "open" | "claimed" | "cancelled" | "reclaimed" {
    switch (status) {
      case OnChainStatus.Claimed:
        return "claimed";
      case OnChainStatus.Cancelled:
        return "cancelled";
      case OnChainStatus.Reclaimed:
        return "reclaimed";
      default:
        return "open";
    }
  }

  private static toSenderLink(
    row: typeof cashLinks.$inferSelect,
    token: { decimals: number }
  ): SenderLink {
    return {
      id: row.id,
      claimAddress: row.claimAddress,
      amount: row.amount,
      amountFormatted: ethers.formatUnits(BigInt(row.amount), token.decimals),
      feeAmount: row.feeAmount,
      feeFormatted: ethers.formatUnits(BigInt(row.feeAmount), token.decimals),
      description: row.description,
      status: row.status,
      expiresAt: row.expiresAt,
      claimedByAddress: row.claimedByAddress,
      createTxHash: row.createTxHash,
      settleTxHash: row.settleTxHash,
      createdAt: row.createdAt,
      settledAt: row.settledAt,
    };
  }

  /**
   * Nudge the sender's dashboard. Best effort, since a dropped hint must never
   * fail a settlement that already happened on chain.
   */
  private static async announce(claimAddress: string): Promise<void> {
    try {
      const [row] = await db
        .select({ senderAddress: cashLinks.senderAddress, status: cashLinks.status })
        .from(cashLinks)
        .where(eq(cashLinks.claimAddress, claimAddress))
        .limit(1);

      if (!row) return;

      await eventHub.publish({
        type: "cashlink",
        address: row.senderAddress,
        claimAddress,
        status: row.status,
      });
    } catch (error) {
      logger.warn(`Could not publish CashLink event for ${claimAddress}:`, error);
    }
  }

  private static decodeRevert(error: unknown): string | null {
    const data = (error as { data?: string })?.data;
    if (typeof data !== "string" || data.length < 10) return null;

    return cashLinkInterface.parseError(data)?.name ?? null;
  }

  /** The contract's error names are precise. They are not sentences. */
  private static explain(name: string): string {
    switch (name) {
      case "LinkNotOpen":
        return "This link has already been used";
      case "LinkExpired":
        return "This link has expired and the money has gone back to the sender";
      case "InvalidClaimSignature":
        return "This link is not valid";
      default:
        return "This link could not be claimed";
    }
  }
}
