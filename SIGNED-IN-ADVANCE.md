# Orders signed in advance: what the design can and cannot do

22 November 2026. **A proof, not a feature.** Nothing in the product uses this. You asked for it to be
proven on the local chain and written up before you decide. The proof is `test/flows/presigned.test.ts`:
five tests against the real pump.fun program on the local validator, all passing. Every claim below
marked **Proven** is one of those tests. Everything else is marked as reasoning or as not yet tried.

## The idea in four sentences

Today a stop loss can only run while the terminal is open, because only your browser can sign. Here you
sign the exact sell **now**, and hand the signed transaction to our server to hold. The server sends it
when the price reaches your trigger. It has no key: it cannot change the coin, the amount, where the
money goes or the lowest price you accepted; it can only choose **when** to send, or not to.

What makes it possible is a Solana feature called a durable nonce. An ordinary signed transaction goes
stale in about a minute. One signed against a nonce account of your own stays good until that nonce is
used or you move it on.

## What was proven

| Claim | Result | How |
| --- | --- | --- |
| It still goes through long after an ordinary transaction would have gone stale | **Proven** | Signed, then 161 slots waited. An ordinary transaction signed at the same moment was refused as expired; the order sold exactly the amount signed |
| It sells exactly what was signed, and the money comes to you | **Proven** | Coin balance fell by the signed amount; SOL arrived in the signer's own wallet |
| Whoever holds it cannot change it | **Proven** | Changing any one of three different bytes makes the signature fail the check every validator makes |
| It cannot be used twice | **Proven** | Sent again twice after it landed: nothing more was sold |
| You can cancel alone, without our server's help or consent | **Proven** | One small transaction of your own moves the nonce on; the held order then does nothing. Closing the nonce account returned its rent |
| It never sells below the price you signed | **Proven** | Signed with a floor 1% under the price; the price was then pushed well below it; the order was sent anyway; the chain refused the sale and no coin left the wallet |
| The holder never gains any authority over your coins | **Proven** | After everything, the coin account is still owned by the signer with no delegate set |
| An order for coins you have since sold by hand sells nothing | **Proven** | 90% sold by hand, then the old order for 100% was sent: refused, nothing sold |

## What it cannot do, and what it costs

**A failed attempt uses the order up. Proven.** This is the most important limit. If the order is sent
and fails on the chain (the price is under your floor at that instant, or you no longer hold the coins),
the nonce still moves on and those signed bytes are dead. You paid a network fee (under 0.00002 SOL in
the test) and you no longer have a stop loss, without having sold. So the server must check before it
sends (a dry run against the current price), and the screen must tell you at once when an order has been
used up. A hostile server could burn your orders this way. It could not take anything.

**A stop loss here has a floor, and a true stop loss does not.** A stop loss means "sell if it falls, at
whatever I can get". What you sign is "sell, but not below X". If the price gaps down through X in one
move, the order cannot sell, and by the rule above an attempt would use it up. The choices are a low
floor (it sells in a crash, and a careless or hostile holder could send it early at a poor price down
to that floor), or a ladder of several signed orders with lower and lower floors. A take profit has no
such problem: its floor is its target.

**The holder chooses the moment.** Nothing on the chain knows your trigger price. The transaction says
only "not below the floor". A server that sent your stop loss while the price was still high would sell
your coins early, at a good price, which you did not ask for. That is the trust you would be giving:
timing, bounded by the floor. Not custody.

**It has no expiry of its own.** A durable nonce does not go stale: that is the point of it. "Good for
24 hours" would be our server's promise to throw the order away, not something the chain enforces. The
only expiry you control is cancelling, which you can do alone (proven). An order you forget about stays
live until you cancel it or sell the coins.

**Amounts are fixed when you sign.** "Sell 50% of what I hold" becomes "sell this many coins". Buy more
later and the order still sells the old number. "Sell everything" needs re-signing after each buy.

**It cannot do orders whose details are not known yet.** Copy trading (which coin? how much?) cannot be
signed in advance at all. A limit **buy** can, since you know the coin and the amount, but the SOL must
be sitting in the wallet when it fires, and nothing reserves it.

**Each open order locks a little SOL.** A nonce account holds about 0.0015 SOL of rent, returned when
you close it (proven). A sell strategy of three take-profit levels and a stop loss on one position is
four orders, about 0.006 SOL locked, plus one signature each. The browser wallet can sign them all in
one go; a wallet extension would ask four times.

**A graduating coin changes the route. Reasoned, not yet tried.** An order signed for the bonding curve
names the curve's accounts. Once the coin has moved to its pool, that order fails, and failing uses it
up. Covering both needs two signed orders per level, one for each route, each on its own nonce, with the
server sending the one that matches. I have not built or tested the pool half.

**pump.fun can break it from their side. Reasoned.** A signed order names pump.fun's fee account and
program layout as they were when you signed. If pump.fun changes either, every held order fails when
sent, and is used up. They do change things: the mainnet recording made this week showed coins priced
in USDC that devnet has never had.

**Not tried at all:** anything on devnet or mainnet; sending through a private route for MEV
protection (a nonce transaction should work in a Jito bundle; unverified); what the server-side store of
orders, its dry runs and its alerts would look like; a wallet extension signing a nonce transaction.

## What our server would hold and see

It would hold signed transactions and the trigger price for each: so it knows your wallet, the coin, the
size and your exit levels before they happen. Someone who broke into the server could send any held
order at once (selling at or above each floor) or burn them. They could not take coins or SOL, and could
not make any new order. Orders would have to be stored encrypted at rest and removed the moment they are
cancelled or used.

## Compared with the other ways

| | Runs with the tab closed | Who can sign | True stop loss | Copy trading | What a breach of the server allows |
| --- | --- | --- | --- | --- | --- |
| While the terminal is open (chosen for now) | No | Only you | Yes | No | Nothing |
| Signed in advance (this) | Yes | Only you, ahead of time | Only down to a floor | No | Sending or burning held orders, each within its floor |
| A hosted signer (what the other terminals do) | Yes | A provider, within a policy | Yes | Yes | Whatever the policy allows, for every user |

## My recommendation, for you to accept or not

Use it for **take profit**, where it has no weak spot, and for a **stop loss as a short ladder** (for
example three orders with floors 10%, 25% and 50% under the trigger), with the screen saying plainly
that below the last floor nothing sells. Keep "while the terminal is open" as the default and present
this as an option the user turns on per position, with the fee and the locked rent shown. Do not use it
for buys or for copy trading.

If you say yes, the order of work is: the pool route and the two-routes-per-level rule, proven on the
local chain; the dry run before every send; the encrypted store and the cancel path; then the screen.
