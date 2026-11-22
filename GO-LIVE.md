# Going live

The commands to run, in order, once the items in `NEEDS.md` exist. Nothing here has been
run against the real services: each step says how to tell that it worked.

"Live" here means **a private preview on devnet**. Mainnet is not covered and is not
supported: Ring balances are still a stand-in, and nothing has had an outside review.

## 0. On your own machine, first

```bash
git clone git@github.com:<you>/<repository>.git && cd <repository>
npm ci
npm run local:fetch          # once: copies the programs from devnet
npm run local                # terminal 1: the local test chain
npm run check                # terminal 2: typecheck, lint, format, every test
npm run build && PORT=4711 npm start &
npm run e2e && npm run crawl && npm run break && npm run motion && npm run scan
npm run doctor               # what is ready, what is missing
```

All of it should pass before anything below. `npm run doctor` never prints a secret.

## 1. The repository (NEEDS item 1)

```bash
git remote add origin git@github.com:<you>/<repository>.git
git push -u origin main
```

Worked if: GitHub shows the commits and the `check` workflow goes green.

## 2. Devnet (items 2 and 3)

Set, in `.env.local` or the host's environment:

```
RING_NETWORK=devnet
HELIUS_API_KEY=<your key>
```

```bash
npm run doctor               # "Chain answers at devnet.helius-rpc.com", both programs present
npm run devnet:setup         # prints an operator wallet address: send it 0.1 devnet SOL from faucet.solana.com
npm run devnet:setup         # again: "Lookup table made"
npm run build && npm run start
```

Worked if: the top line of the site reads "Runs on Solana devnet. Ring balances are not
connected yet", `/status` shows the programs deployed and the lookup table present, and you
can launch a coin and buy it from a wallet you funded at the faucet.

Not available on devnet in this build: Ring balances, OTC, pay links, the sealed window.
They need the real Ring wired in, which needs the key to develop against.

## 3. The database (item 6)

```
DATABASE_URL=postgresql://...
```

```bash
npm run doctor               # "Database answers; state table ready"
```

Worked if: after a launch, restarting the server keeps the coin listed. Run one server
only: a second one pointed at the same database refuses to start, by design.

To prove the store on your own machine first: `npm run test:flows:pg`.

## 4. Pictures (item 12)

```
PINATA_JWT=<your key>
```

Worked if: a coin launched with a picture shows it on Explore, and the picture's address
starts `https://gateway.pinata.cloud/ipfs/`. Without the key, pictures are kept on the
server's disk and are lost when a host replaces the disk.

## 5. Hosting (item 7), as a private preview

```
SITE_URL=https://<your domain>
PREVIEW_PASSWORD=<a long password>
```

Build with `npm run build`, start with `npm start` (it listens on `PORT`), or use the
`Dockerfile`. Health check address: `/health`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<your domain>/            # 401: the preview is private
curl -s -u any:<password> https://<your domain>/api/config -X POST -d '{}'  # {"network":"devnet",...}
curl -s https://<your domain>/health                                        # {"server":true,"chain":true}
```

Worked if: the three answers match. Keep `PREVIEW_PASSWORD` set until you decide the site
may be public.

The read-only checks can be pointed at a deployed copy, while its password is not yet set:

```bash
CHECK_URL=https://<your domain> npm run scan      # no secret in anything served
CHECK_URL=https://<your domain> npm run motion    # the scroll sequence on the real host
CHECK_URL=https://<your domain> npm run measure   # page weight and load time over a real network
```

## 6. Media, name, operator, email (items 5, 4, 9)

```bash
# after saving the real files over brand/hero.png, hero.mp4, layers.png, logo.png, banner.png
npm run media
npm run shots && npm run motion
```

Operator name, country and contact: `operator` in `site.config.ts`. `npm run doctor`
says when no placeholder is left.

## 7. The sealed launch window

`FEATURE_SEALED_WINDOW=on`. It works only where the stand-in Ring does, which is a local
validator. Do not switch it on anywhere else.

## Before any coin of value

Not a command: the real Ring in place of the stand-in, an outside security review, a
lawyer's review, and tests on the browsers and devices in `NEEDS.md`.
