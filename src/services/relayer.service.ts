import { ethers } from "ethers";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { relayedTransactions } from "../db/schema.js";
import { ENV } from "../config/environment.js";
import { provider } from "../config/blockchain.js";
import { AppError } from "../middlewares/errorHandler.middleware.js";
import logger from "../utils/logger.util.js";

/**
 * The one key this deployment sends transactions from.
 *
 * It used to relay ERC-2771 requests on behalf of users. That is gone: every
 * user is an ERC-4337 smart account now, so their writes are UserOperations paid
 * for by the paymaster and this process never sees them.
 *
 * What is left is the work no user can sign for. The CashLink escrow's `claim`
 * and `reclaim` read no sender, taking their authority from a claim signature
 * checked on chain or a deadline that has passed, and `reclaim` in particular
 * runs on a timer after the sender has gone away. The EVM has no timers, so
 * something off chain has to send it.
 */
export class RelayerService {
  private static signer: ethers.Wallet | null = null;

  /**
   * Submissions are serialised.
   *
   * One key means one nonce sequence. Two concurrent sends would either reuse a
   * nonce or leave a gap that stalls everything behind it, and the failure only
   * shows up under load.
   */
  private static queue: Promise<unknown> = Promise.resolve();

  /** Null means "read it from the chain again". Only touched inside the queue. */
  private static nextNonce: number | null = null;

  static get enabled(): boolean {
    return Boolean(ENV.RELAYER_PRIVATE_KEY);
  }

  private static wallet(): ethers.Wallet {
    if (!RelayerService.enabled) {
      throw new AppError("Sponsored sends are not configured", 503);
    }

    RelayerService.signer ??= new ethers.Wallet(ENV.RELAYER_PRIVATE_KEY, provider);
    return RelayerService.signer;
  }

  /**
   * Serialised, and the nonce is this service's own to hand out.
   *
   * Letting the provider derive it per send is not enough even when sends are
   * serialised: a count read back over RPC can lag a transaction that is already
   * mined, and the send is then rejected as "nonce too low". Counting locally
   * from one reading is exact, and any failure drops back to the chain rather
   * than guessing whether the nonce was spent.
   */
  private static enqueue(
    send: (nonce: number) => Promise<ethers.TransactionResponse>
  ): Promise<ethers.TransactionResponse> {
    const queued = RelayerService.queue.then(async () => {
      RelayerService.nextNonce ??= await RelayerService.wallet().getNonce("pending");

      try {
        const tx = await send(RelayerService.nextNonce);
        RelayerService.nextNonce += 1;
        return tx;
      } catch (error) {
        RelayerService.nextNonce = null;
        throw error;
      }
    });

    // Keep the chain going even when one send fails.
    RelayerService.queue = queued.catch(() => undefined);

    return queued;
  }

  /**
   * Say something before the key runs dry.
   *
   * This key funds CashLink refunds, and `reclaim` is what makes a refund
   * automatic rather than custodial. An empty key does not fail a user's
   * request, it silently stops returning money to people whose links lapsed,
   * which is the kind of outage nobody reports because nobody sees it.
   *
   * Checked on the sweep rather than on a timer of its own, so it costs one
   * call on a loop that was already going to run.
   */
  static async warnIfLow(): Promise<bigint | null> {
    if (!RelayerService.enabled) return null;

    try {
      const balance = await provider.getBalance(RelayerService.wallet().address);

      if (balance < ENV.SWEEPER_MIN_BALANCE_WEI) {
        logger.warn(
          `Sweeper key is low: ${ethers.formatEther(balance)} ETH at ` +
            `${RelayerService.wallet().address}. CashLink refunds stop when it empties.`
        );
      }

      return balance;
    } catch (error) {
      logger.warn("Could not read the sweeper key balance:", error);
      return null;
    }
  }

  /** Pay for a call nobody signed a request for. */
  static async sendDirect(options: {
    to: string;
    data: string;
    gasLimit: bigint;
    functionName: string;
    /** Who the gas is ledgered against. */
    fromAddress: string;
    userId?: string | null;
  }): Promise<ethers.TransactionResponse> {
    const wallet = RelayerService.wallet();

    const tx = await RelayerService.enqueue((nonce) =>
      wallet.sendTransaction({
        to: options.to,
        data: options.data,
        gasLimit: options.gasLimit,
        nonce,
      })
    );

    await db.insert(relayedTransactions).values({
      fromAddress: options.fromAddress.toLowerCase(),
      userId: options.userId ?? null,
      organizationId: null,
      targetAddress: options.to.toLowerCase(),
      selector: options.data.slice(0, 10).toLowerCase(),
      functionName: options.functionName,
      txHash: tx.hash,
    });

    void RelayerService.recordReceipt(tx);

    return tx;
  }

  /**
   * Wait on the response rather than re-looking the hash up.
   *
   * `waitForTransaction` polls for a new block, so against a chain that is
   * otherwise idle it sits there even though the receipt already exists.
   */
  private static async recordReceipt(tx: ethers.TransactionResponse): Promise<void> {
    const txHash = tx.hash;

    try {
      const receipt = await tx.wait(1, 120_000);
      if (!receipt) return;

      const gasPrice = receipt.gasPrice ?? 0n;

      await db
        .update(relayedTransactions)
        .set({
          status: receipt.status === 1 ? "confirmed" : "failed",
          gasUsed: receipt.gasUsed.toString(),
          gasPriceWei: gasPrice.toString(),
          feeWei: (receipt.gasUsed * gasPrice).toString(),
          confirmedAt: new Date(),
        })
        .where(eq(relayedTransactions.txHash, txHash));
    } catch (error) {
      logger.warn(`Could not record send receipt for ${txHash}:`, error);
    }
  }
}
