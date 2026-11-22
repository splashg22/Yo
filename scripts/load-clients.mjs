// One thread of the load test: holds live connections to the server, or reads its API, and reports what it saw.
// Run by scripts/load.ts, not by hand. It is its own thread so that the clients' work is not billed to the server.
import { parentPort, workerData } from "node:worker_threads";

const { role, url, channel, clients, sampled, mint, readsPerSecond } = workerData;

if (role === "live") {
  /** How many confirmed trades each client was handed. Every client must end on the same number. */
  const confirmed = new Array(clients).fill(0);
  let open = 0;
  let closedEarly = 0;
  let resets = 0;
  let frames = 0;
  /** For the sampled clients only: when each trade arrived, early and confirmed. [signature, "e" | "t", ms] */
  const arrivals = [];
  const sockets = [];
  for (let index = 0; index < clients; index++) {
    const socket = new WebSocket(url);
    sockets.push(socket);
    socket.onopen = () => {
      socket.send(JSON.stringify({ t: "sub", ch: channel }));
      if (++open === clients) parentPort.postMessage({ ready: true });
    };
    socket.onclose = () => {
      if (!stopping) closedEarly++;
    };
    socket.onmessage = (message) => {
      const now = Date.now();
      const frame = JSON.parse(message.data);
      if (frame.reset) return void resets++;
      if (!frame.d) return;
      frames++;
      for (const event of frame.d) {
        if (event[0] === "t") confirmed[index]++;
        if (index < sampled && (event[0] === "t" || event[0] === "e")) arrivals.push([event[1].s, event[0], now]);
      }
    };
  }
  let stopping = false;
  parentPort.on("message", (message) => {
    if (!message.stop) return;
    stopping = true;
    for (const socket of sockets) socket.close();
    parentPort.postMessage({ done: true, confirmed, arrivals, closedEarly, resets, frames });
  });
} else {
  // The API reader: the reads a coin page and the board make, at a steady pace, each one timed.
  const took = { explore: [], coin: [], "coin/trades": [], "coin/candles": [], "coin/holders": [] };
  const bodies = {
    explore: {},
    coin: { mint },
    "coin/trades": { mint, limit: 100 },
    "coin/candles": { mint, tf: 1, limit: 300 },
    "coin/holders": { mint },
  };
  let failed = 0;
  let stopping = false;
  const names = Object.keys(bodies);
  let turn = 0;
  const timer = setInterval(() => {
    const name = names[turn++ % names.length];
    const started = performance.now();
    fetch(`${url}/api/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bodies[name]) })
      .then(async (answer) => {
        await answer.arrayBuffer();
        if (!answer.ok) failed++;
        else took[name].push(performance.now() - started);
      })
      .catch(() => failed++);
  }, 1000 / readsPerSecond);
  parentPort.postMessage({ ready: true });
  parentPort.on("message", (message) => {
    if (!message.stop || stopping) return;
    stopping = true;
    clearInterval(timer);
    setTimeout(() => parentPort.postMessage({ done: true, took, failed }), 500);
  });
}
