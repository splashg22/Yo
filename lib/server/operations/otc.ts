/** OTC: a block offered to one named buyer at a size and price only the two of them see. */
import { NATIVE } from "../../constants";
import { randomBytes, toHex } from "../../bytes";
import { settings } from "../env";
import { ring } from "../ring";
import { save, state, type Offer } from "../store";
import { addressOf, amountOf, text } from "../validate";
import { readerOf, signedBody } from "./ring";
import type { Handlers } from "./types";

const HOUR_MS = 3_600_000;
const LONGEST_OFFER_HOURS = 168;

function offerFor(id: unknown): Offer {
  const offer = state().offers.find((candidate) => candidate.id === text(id, "offer", 40));
  if (!offer) throw new Error("that offer does not exist");
  return offer;
}
function requireOpen(offer: Offer): void {
  if (offer.status !== "open") throw new Error(`the offer is already ${offer.status}`);
  if (Date.now() > offer.expiresAt) throw new Error("the offer has expired");
}

export const otc: Handlers<"otc/offer" | "otc/mine" | "otc/cancel" | "otc/accept"> = {
  "otc/offer": (input) => {
    const body = signedBody("otc/offer", input);
    const hours = body.hours === undefined ? 24 : body.hours;
    if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > LONGEST_OFFER_HOURS)
      throw new Error(`an offer lasts 1 to ${LONGEST_OFFER_HOURS} hours`);
    const buyer = addressOf(body.buyer, "buyer's address");
    if (buyer === body.wallet) throw new Error("the buyer must be another wallet");
    const mint = addressOf(body.mint, "coin address");
    if (mint === NATIVE) throw new Error("choose a coin to sell; the price is paid in SOL");
    const amount = amountOf(body.amount, "size");
    const price = amountOf(body.priceLamports, "price");
    if (BigInt(ring.balances(body.wallet)[mint] ?? "0") < amount) throw new Error("you do not hold that block in your Ring balance");
    const offer: Offer = {
      id: toHex(randomBytes(6)),
      seller: body.wallet,
      buyer,
      mint,
      amount: amount.toString(),
      priceLamports: price.toString(),
      createdAt: Date.now(),
      expiresAt: Date.now() + hours * HOUR_MS,
      status: "open",
    };
    state().offers.push(offer);
    save();
    return { offer };
  },

  /** Only the two parties can list an offer. */
  "otc/mine": (input) => {
    const wallet = readerOf("otc/mine", input);
    return {
      offers: state()
        .offers.filter((offer) => offer.seller === wallet || offer.buyer === wallet)
        .slice(-100)
        .reverse(),
    };
  },

  "otc/cancel": (input) => {
    const body = signedBody("otc/cancel", input);
    const offer = offerFor(body.id);
    if (offer.seller !== body.wallet) throw new Error("that is not your offer");
    if (offer.status !== "open") throw new Error(`the offer is already ${offer.status}`);
    offer.status = "cancelled";
    save();
    return { offer };
  },

  /** The buyer accepts: the coin and the payment change hands together, or nothing moves. */
  "otc/accept": (input) => {
    const body = signedBody("otc/accept", input);
    const offer = offerFor(body.id);
    if (offer.buyer !== body.wallet) throw new Error("that offer is not addressed to you");
    requireOpen(offer);
    if (!ring.isRegistered(offer.buyer)) ring.register(offer.buyer);
    // This site's fee, when one is set, is paid by the buyer on top of the price. Checked first, so a buyer who
    // cannot cover both pays neither.
    const price = BigInt(offer.priceLamports);
    const { fees } = settings();
    const fee = (price * BigInt(fees.otcBps)) / 10_000n;
    if (fee > 0n && BigInt(ring.balances(offer.buyer)[NATIVE] ?? "0") < price + fee)
      throw new Error("the buyer's Ring balance does not cover the price and this site's fee");
    const event = ring.swap(offer.seller, offer.buyer, offer.mint, BigInt(offer.amount), NATIVE, price);
    if (fee > 0n) {
      if (!ring.isRegistered(fees.wallet)) ring.register(fees.wallet);
      ring.moveBetween(offer.buyer, fees.wallet, NATIVE, fee);
      offer.feeLamports = fee.toString();
    }
    offer.status = "settled";
    save();
    return { offer, event };
  },
};
