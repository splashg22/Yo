# What I need from you

21 November 2026. One list, ordered by how much work each item unblocks.

**Updated after the last round of building.** Most of what these items unlock is now built
against stand-ins and switched by one setting each, so providing an item is mostly a
matter of setting a value and running the commands in `GO-LIVE.md`. What each item still
needs from me afterwards is said under it. The decisions in item 4 are made.

**Prices and free tiers below are from memory and were not checked today.** Confirm each
on the provider's pricing page before you choose a plan.

**How a secret reaches me.** This work runs in a cloud session, so there is no `.env` file
of yours for me to read. You enter each key yourself in the session's environment
settings: the cloud environment menu in the session's title bar, then Edit, then add an
environment variable with the exact name given below. A new session picks it up. On your
own machine the same names go in `.env.local`. Never paste a key into the chat.

## Never give me these

- Any mainnet private key, seed phrase or keypair file.
- The password or seed of any wallet of yours.
- Passwords, two-factor codes or recovery codes for GitHub, hosting, the domain registrar,
  an exchange or email.
- Card details.
- Admin or billing-level API keys where a narrower key exists.

If a step ever seems to need one of these, it is the wrong step. Mainnet keys are created
and held by you and entered by you into the hosting provider's own secrets screen.

## Summary

| # | Item | Needed to launch? | Under 5 min? | Recommended | Monthly cost | Where it goes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Private GitHub repository | Required | Yes | GitHub | 0 | Tell me its name |
| 2 | Helius API key | Required | Yes | Helius, free tier | 0 to about 49 | `HELIUS_API_KEY` |
| 3 | Devnet SOL | Required for the devnet pass | Yes | Solana's faucet | 0 | Sent to an address I give you |
| 4 | Decisions | Made on 21 November | | | 0 | Recorded in `DECISIONS.md`, row 63 |
| 5 | Real brand media | Required | No | Higgsfield, your account | Your plan | `brand/` in the repository |
| 6 | Database | Required | Yes | Neon | 0 to about 19 | `DATABASE_URL` |
| 7 | Hosting | Required | No | Railway | About 5 to 20 | Their dashboard |
| 8 | Domain | Required | Yes | Cloudflare Registrar | About 1 | Hosting dashboard, `SITE_URL` |
| 9 | Contact email | Required | Yes | Cloudflare Email Routing | 0 | `operator.contact` in `site.config.ts` |
| 10 | Lawyer's review | Required | No | A crypto-literate lawyer | One-off | Edits to two pages |
| 11 | Outside security review | Required before real money | No | An audit firm | One-off | A report |
| 12 | Coin image storage | Required for coins with pictures | Yes | Pinata | 0 to about 20 | `PINATA_JWT` |
| 13 | Mainnet wallets and keys | Required for mainnet only | No | Made by you | 0 | Hosting secrets, entered by you |
| 14 | Real devices and wallets | Required | No | Yours | 0 | You test, or BrowserStack |
| 15 | Shared request counter | Optional | Yes | Upstash | 0 | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| 16 | Error tracking | Optional | Yes | Sentry | 0 to about 26 | `SENTRY_DSN` |
| 17 | Uptime check | Optional | Yes | UptimeRobot | 0 | Their dashboard |
| 18 | Analytics | Optional, not advised | Yes | Plausible | About 9 | `PLAUSIBLE_DOMAIN` |
| 19 | Price in dollars | Nothing needed | | Pyth, read from the chain | 0 | |

## 1. Private GitHub repository

1. **What:** a private home for the code. Until it exists the code lives only in this
   session and in the bundle file I sent; a new session cannot continue without it.
2. **Required.**
3. **GitHub**, free for private repositories. Alternative: GitLab, free.
4. **Steps** (under 5 minutes): github.com, New repository. Name it, for example
   `ringpad`. Choose Private. Add no README, licence or .gitignore. Then
   github.com/apps/claude, Configure, your account, Repository access, add the new
   repository.
5. **Where:** tell me the repository's name in chat. A name is not a secret.
6. **Then:** I push every commit to `main`. The workflow that runs typecheck, lint, the
   unit tests, a build and the Postgres store tests on every push is already in the
   repository (`.github/workflows/check.yml`) and has never run: its first run is the
   test of it. To remove the old branch from the public `Yo`:
   `git push https://github.com/splashg22/Yo.git --delete claude/exciting-gates-vdquz4`.

## 2. Helius API key

1. **What:** access to Solana through Helius, including the indexer that Privacy Rings
   needs. It is what lets the real Ring replace the stand-in.
2. **Required.** Nothing about real Ring balances can be built or tested without it.
3. **Helius.** Free tier: about a million credits a month, enough for devnet work.
   Developer plan about $49 a month for launch traffic. Alternative for plain chain access
   only: Triton or QuickNode, from about $49. Neither serves the Rings indexer, so Helius
   is needed either way.
4. **Steps** (under 5 minutes): dashboard.helius.dev, sign up, create a project, copy the
   API key. Free plan is enough to start. If the dashboard offers allowed domains or IP
   limits, leave them open for now.
5. **Where:** environment variable `HELIUS_API_KEY`. Server only; it is never sent to a
   browser.
6. **Then:** set `RING_NETWORK=devnet` and run `npm run doctor`, `npm run devnet:setup`,
   `npm run build`, `npm run start`. Launching, buying and selling are built for devnet
   and have only been run against a local chain standing in for it, so the first run is
   the test. What I still have to build with the key: the real Ring's deposit, transfer
   and withdraw with proofs made in the browser, in place of the stand-in (privacy stage 2
   in `PRIVACY-AUDIT.md`), and the SOL price in dollars. `npm run scan` then confirms the
   key is in nothing served.

## 3. Devnet SOL

1. **What:** test coins with no value, to pay fees on Solana's test network.
2. **Required** for the devnet pass.
3. **Solana's faucet**, free, a few SOL a day. Alternative: Helius's faucet, free.
4. **Steps** (under 5 minutes): `npm run devnet:setup` prints the address of a
   devnet-only operator wallet. Open faucet.solana.com, choose Devnet, paste the address,
   request the largest amount offered, and run the command again. For your own test
   wallet, make one on the site's Ring wallet page and fund its address the same way.
5. **Where:** sent to those addresses. You handle no key.
6. **Then:** `npm run devnet:setup` makes the lookup table and says so.

## 4. Decisions

Made, and each is one config value if you change your mind:

- **The name:** RINGPAD. `name` in `site.config.ts`.
- **The sealed launch window:** built, off. `FEATURE_SEALED_WINDOW`.
- **Wallet extensions and notes:** they sign one extra message when they connect.
- **Who runs it:** a marked placeholder. `operator` in `site.config.ts`: name, country, contact.
- **Public preview:** no. Set `PREVIEW_PASSWORD` on any deployed copy.

Still open, and yours: the operator's real name, country and contact address.

## 5. Real brand media

1. **What:** the ring pictures, the six-second video, the logo and the link preview. Every
   one on the site today is a placeholder drawn in code.
2. **Required.**
3. **Higgsfield**, on your existing account. Alternative: any renderer that meets the
   sizes in `brand/README.md`.
4. **Steps:** run the six prompts in `brand/HIGGSFIELD-PROMPTS.md`. Download the results.
   Name them exactly `hero.png`, `hero.mp4`, `layers.png`, `logo.png`, `banner.png`. The
   background must be true black.
5. **Where:** the `brand/` folder of the repository, over the files there (upload on
   GitHub, or commit them).
6. **Then I will:** run `npm run media`, re-measure where the callouts point, retake every
   screenshot, and rerun the motion checks and the test that the media is on true black.

## 6. Database

1. **What:** a Postgres database for coins listed, price readings, OTC offers and used
   request numbers. Today these sit in one file on the server.
2. **Required** to launch. A file cannot be shared between servers or backed up properly.
3. **Neon.** Free tier: about half a gigabyte, enough to launch. Paid from about $19 a
   month. Alternative: Supabase, free tier, paid from about $25.
4. **Steps** (under 5 minutes): neon.tech, sign up, New project, choose the region nearest
   your hosting, copy the connection string that starts `postgresql://`. Choose the pooled
   connection if offered.
5. **Where:** environment variable `DATABASE_URL`.
6. **Then:** `npm run doctor` should say "Database answers". It is built: the whole flow
   suite and the browser run pass against a real local Postgres. It has not been run
   against a hosted provider. Run one server only; a second refuses to start.

## 7. Hosting

1. **What:** where the site and its server run.
2. **Required** to launch. Not needed for the devnet pass.
3. **Railway**, about $5 a month plus usage, runs the server as one long-lived process,
   which suits the request limiter. Alternative: Vercel, Pro about $20 a month (its free
   plan does not allow commercial use); it needs item 15 as well.
4. **Steps:** sign up, New project, Deploy from GitHub, pick the private repository,
   set the start command to `npm run start`. Add the environment variables from this file
   in the project's Variables screen. Do not make the address public until you decide to.
5. **Where:** the provider's dashboard. Secrets are entered there by you.
6. **Then:** build `npm run build`, start `npm run start -- -p $PORT`, health check
   `/health`, and set `PREVIEW_PASSWORD`, `SITE_URL` and `TRUSTED_PROXY_HOPS=1`. A
   `Dockerfile` is in the repository and has not been built. `GO-LIVE.md` has the three
   `curl` checks, and `CHECK_URL=https://<domain> npm run scan` checks the deployed copy.

## 8. Domain

1. **What:** the site's address.
2. **Required** for a public launch.
3. **Cloudflare Registrar**, at cost, about $10 to $15 a year for a `.com`. Alternative:
   Namecheap, similar.
4. **Steps** (under 5 minutes once you have a name): buy it, then in the hosting
   dashboard add it as a custom domain and copy the DNS records it shows into the
   registrar.
5. **Where:** hosting dashboard; environment variable `SITE_URL`, for link previews.
6. **Then I will:** check the link preview, the security headers and that every page
   answers on the new address.

## 9. Contact email

1. **What:** an address for the legal pages and for security reports.
2. **Required.** The Terms and Privacy Policy must say who to contact.
3. **Cloudflare Email Routing**, free, forwards mail at your domain to an inbox you have.
   Alternative: Google Workspace, about $7 a month.
4. **Steps** (under 5 minutes after item 8): in Cloudflare, Email, Email Routing, add an
   address such as `hello@` and the inbox it forwards to.
5. **Where:** `operator.contact` in `site.config.ts`. An address is not a secret.
6. **Then:** put it in `operator.contact` in `site.config.ts`, with the name and country.
   The legal pages show all three, and `npm run doctor` says when no placeholder is left.

## 10. Lawyer's review

1. **What:** a lawyer reading the Terms, the Privacy Policy and the product itself: OTC
   blocks, pay links, privacy features, and what the law where you operate requires,
   including sanctions screening.
2. **Required.** Both pages are marked as unreviewed drafts.
3. A lawyer who works with crypto products. One-off; fees vary widely and I will not guess.
4. **Steps:** send them `/terms`, `/privacy`, `PRIVACY-AUDIT.md` and `/technical`.
5. **Where:** their changes, sent to me as text or edited in the repository.
6. **Then I will:** apply them, remove the draft notice only when you say the review is
   done, and check every sentence still matches the code.

## 11. Outside security review

1. **What:** an independent firm reviewing the server's money logic, the wallet and backup
   code, the sealed notes, and the Ring integration.
2. **Required before any coin of value.** Not before devnet.
3. An audit firm with Solana experience. One-off, usually tens of thousands of dollars.
4. **Steps:** after the devnet pass, share the private repository with the firm.
5. **Where:** their report.
6. **Then I will:** fix each finding with a test, and publish the report on the technical
   page if you agree.

## 12. Coin image storage

1. **What:** a place to keep each coin's picture and description. Coins are created today
   with no picture.
2. **Required** for coins with pictures. Optional for the devnet pass.
3. **Pinata**, free tier about one gigabyte, paid about $20 a month. Alternative:
   Irys (Arweave), paid per upload, no monthly fee.
4. **Steps** (under 5 minutes): pinata.cloud, sign up, API Keys, New key, allow only
   pinning files and JSON, copy the JWT.
5. **Where:** environment variable `PINATA_JWT`.
6. **Then:** nothing to build. Pictures already work, kept on the server's disk; with the
   key they go to IPFS instead. That upload is written and has not been run against
   Pinata: the first launch with a picture is the test, and `GO-LIVE.md` says what to look for.

## 13. Mainnet wallets and keys

1. **What:** the wallets a live deployment needs: one that pays for the launch lookup
   table, and later one for a withdrawal relayer.
2. **Required for mainnet only.** I will not ask for it before you tell me to go there.
3. Made by you, with a hardware wallet where the key is for holding rather than signing
   automatically.
4. **Steps:** when the time comes I list each wallet, what it may do and how much SOL it
   needs. You create them and fund them.
5. **Where:** you enter the keys in the hosting provider's secrets screen. I never see them.
6. **Then I will:** read only the public addresses and confirm from the chain that each
   is funded and does what it should.

## 14. Real devices and wallets

1. **What:** the site tried in Safari, Firefox, on an iPhone and an Android phone, and
   with real wallet extensions. I have tested only one desktop browser engine.
2. **Required** before launch.
3. Your own devices. Alternative: BrowserStack, about $39 a month, which I may be able to
   drive from here: `BROWSERSTACK_USERNAME`, `BROWSERSTACK_ACCESS_KEY`.
4. **Steps:** once there is a devnet deployment, open it on each, make a wallet, launch a
   coin, deposit, transfer, withdraw. Tell me anything that looks or behaves wrong.
5. **Where:** a list in chat.
6. **Then I will:** fix each and add it to the checks where it can be automated.

## 15. Shared request counter (optional)

1. **What:** a small key-value store so the limit on requests per address holds across
   several servers.
2. **Optional.** Needed only with more than one server, or on Vercel.
3. **Upstash Redis**, free tier. Alternative: Redis on Railway, about $5.
4. **Steps** (under 5 minutes): upstash.com, create a Redis database, copy the REST URL
   and token.
5. **Where:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
6. **Then I will:** move the counter there and test the limit across two server processes.

## 16. Error tracking (optional)

1. **What:** a record of errors on the server, so problems are seen before users report them.
2. **Optional.** Faster fixes. It also sends data to a third party, which a privacy
   product should weigh.
3. **Sentry**, free tier about 5,000 errors a month, paid about $26. Alternative:
   GlitchTip, self-hosted, free.
4. **Steps** (under 5 minutes): sentry.io, new Next.js project, copy the DSN.
5. **Where:** `SENTRY_DSN`.
6. **Then I will:** report server errors only, with addresses, IPs and request bodies
   stripped, and test that a forced error arrives without them.

## 17. Uptime check (optional)

1. **What:** a service that opens the site every few minutes and tells you if it is down.
2. **Optional.**
3. **UptimeRobot**, free. Alternative: Better Stack, free tier.
4. **Steps** (under 5 minutes): add a monitor for the health-check address I give you.
5. **Where:** their dashboard.
6. **Then I will:** nothing more; the health route comes with item 7.

## 18. Analytics (optional, not advised)

1. **What:** counts of visits and pages.
2. **Optional.** I advise against it: the product's promise is that we see as little as
   possible. If you want it, use one without cookies or personal data.
3. **Plausible**, about $9 a month. Alternative: none.
4. **Steps:** plausible.io, add the domain.
5. **Where:** `PLAUSIBLE_DOMAIN`.
6. **Then I will:** add it, say so in the Privacy Policy and `PRIVACY-AUDIT.md`, and test
   that no address or wallet is in what it sends.

## 19. Price in dollars

Nothing needed from you. The SOL price can be read from Pyth's price account on the chain
through the Helius key. I will add it in the devnet pass and label its source.

## Not needed

- An email-sending service. The site sends no email.
- A separate RPC provider. Helius covers it.
- A token. None is planned, and I will ask before adding one.

## Total monthly cost

| Setup | Items | About, per month |
| --- | --- | --- |
| Minimum | Helius free, GitHub free, Neon free, Railway, domain, email routing | $6 to $10 |
| Best | Helius Developer $49, Railway or Vercel Pro $20, Neon $19, Pinata $20, Sentry $26, BrowserStack $39, Upstash free, domain $1 | About $175 |

One-off, not included: the lawyer, the outside security review, and your Higgsfield plan.

## After you provide them: the commands

`GO-LIVE.md` has them in order, with how to tell each step worked. In short:

```bash
git remote add origin git@github.com:<you>/<repository>.git && git push -u origin main
# set RING_NETWORK=devnet, HELIUS_API_KEY, DATABASE_URL, PINATA_JWT, SITE_URL, PREVIEW_PASSWORD, TRUSTED_PROXY_HOPS=1
npm ci
npm run doctor            # every line "ok" except what you have chosen to leave
npm run devnet:setup      # prints a wallet to fund at faucet.solana.com; run again once funded
npm run media             # after saving the real files into brand/
npm run build && npm run start
```

## The first five minutes

Items 1 and 2. With a private repository and a Helius key I can do the devnet pass, which
is the largest piece of work left.
