/** Fetching from an address a stranger chose: what is refused before any request is made. */
import { describe, expect, it } from "vitest";
import { addressesFor, pictureIn } from "../../lib/server/coin-image";
import { isPublicAddress, outsideUrl } from "../../lib/server/outside";

describe("an address chosen by a stranger", () => {
  it("is fetched only over https, on the usual port, with no name or password in it", () => {
    expect(outsideUrl("https://example-host.com/a.json").hostname).toBe("example-host.com");
    for (const bad of [
      "http://example-host.com/a.json",
      "ftp://example-host.com/a",
      "file:///etc/passwd",
      "data:text/plain,hello",
      "javascript:alert(1)",
      "https://user:secret@example-host.com/",
      "https://example-host.com:8443/",
      "not an address",
      "",
      `https://example-host.com/${"a".repeat(700)}`,
    ])
      expect(() => outsideUrl(bad), bad).toThrow();
  });

  it("is never this machine or a private network, by name or by number", () => {
    for (const bad of [
      "https://localhost/",
      "https://printer/",
      "https://db.internal/",
      "https://box.local/",
      "https://127.0.0.1/",
      "https://10.1.2.3/",
      "https://172.16.0.9/",
      "https://192.168.1.1/",
      "https://169.254.169.254/latest/meta-data/",
      "https://100.64.0.1/",
      "https://0.0.0.0/",
      "https://[::1]/",
      "https://[fd00::1]/",
      "https://[fe80::1]/",
      "https://[::ffff:127.0.0.1]/",
      "https://[::ffff:7f00:1]/",
    ])
      expect(() => outsideUrl(bad), bad).toThrow();
    expect(outsideUrl("https://8.8.8.8/x").hostname).toBe("8.8.8.8");
  });

  it("tells a public address from a private or reserved one", () => {
    for (const good of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "2606:4700:4700::1111"]) expect(isPublicAddress(good), good).toBe(true);
    for (const bad of [
      "127.0.0.1",
      "10.0.0.1",
      "172.20.1.1",
      "192.168.0.5",
      "169.254.1.1",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fc00::1",
      "ff02::1",
      "nonsense",
    ])
      expect(isPublicAddress(bad), bad).toBe(false);
  });

  it("reads ipfs and arweave addresses through a public gateway", () => {
    expect(outsideUrl("ipfs://QmQ77MDu7SSB599eVZr2MhYA3bUYuVmbNvZgS7R2x58SJr").toString()).toBe(
      "https://ipfs.io/ipfs/QmQ77MDu7SSB599eVZr2MhYA3bUYuVmbNvZgS7R2x58SJr",
    );
    expect(outsideUrl("ar://abc123").toString()).toBe("https://arweave.net/abc123");
  });

  it("tries each public gateway for IPFS content, and only the address itself for anything else", () => {
    const cid = "QmQ77MDu7SSB599eVZr2MhYA3bUYuVmbNvZgS7R2x58SJr";
    const want = [`https://ipfs.io/ipfs/${cid}`, `https://dweb.link/ipfs/${cid}`, `https://gateway.pinata.cloud/ipfs/${cid}`];
    expect(addressesFor(`https://ipfs.io/ipfs/${cid}`)).toEqual(want);
    expect(addressesFor(`ipfs://${cid}`)).toEqual(want);
    expect(addressesFor(`https://some.gateway.example/ipfs/${cid}/picture.png`)[0]).toBe(`https://ipfs.io/ipfs/${cid}/picture.png`);
    expect(addressesFor("https://example-host.com/coin.json")).toEqual(["https://example-host.com/coin.json"]);
  });

  it("takes one field from a description and nothing else", () => {
    expect(pictureIn(Buffer.from(JSON.stringify({ name: "x", image: "https://example-host.com/p.png", script: "<script>" })))).toBe(
      "https://example-host.com/p.png",
    );
    expect(pictureIn(Buffer.from(JSON.stringify({ image: 5 })))).toBeUndefined();
    expect(pictureIn(Buffer.from("<html>not json</html>"))).toBeUndefined();
  });
});
