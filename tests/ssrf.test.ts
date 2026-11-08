import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateIp } from "@/lib/server/events";
import { DharaError } from "@/lib/server/oracle";

/**
 * SSRF guard (CWE-918) for webhook URLs — pure validation, no network calls.
 *
 * NOTE: `isPrivateIp` (the DNS-resolution validator) is module-private in
 * events.ts, so it is exercised indirectly here: assertPublicUrl's IPv6-literal
 * branch implements the same private/loopback/link-local range checks
 * (::1, fc00::/7, fe80::/10, ::ffff:<ipv4> mapped forms).
 */

function expectBlocked(raw: string, code = "ssrf_blocked") {
  let err: unknown = null;
  try {
    assertPublicUrl(raw);
  } catch (e) {
    err = e;
  }
  expect(err, `expected ${raw} to be blocked`).toBeInstanceOf(DharaError);
  expect((err as DharaError).code).toBe(code);
}

describe("assertPublicUrl — scheme allow-list", () => {
  it("allows http and https", () => {
    expect(() => assertPublicUrl("http://example.com/hook")).not.toThrow();
    expect(() => assertPublicUrl("https://example.com/hook")).not.toThrow();
  });

  it("rejects ftp and file schemes", () => {
    expectBlocked("ftp://example.com/file", "bad_url");
    expectBlocked("file:///etc/passwd", "bad_url");
  });

  it("rejects malformed URLs", () => {
    expectBlocked("not a url", "bad_url");
    expectBlocked("", "bad_url");
    expectBlocked("http://", "bad_url");
  });
});

describe("assertPublicUrl — blocked hostnames", () => {
  it("rejects localhost variants and cloud metadata hosts", () => {
    expectBlocked("http://localhost/hook");
    expectBlocked("http://localhost.localdomain/hook");
    expectBlocked("http://ip6-localhost/hook");
    expectBlocked("http://ip6-loopback/hook");
    expectBlocked("http://metadata.google.internal/computeMetadata/v1/");
    expectBlocked("http://metadata/");
    expectBlocked("http://instance-data/");
  });

  it("rejects .local and .internal subdomains", () => {
    expectBlocked("http://db.internal/hook");
    expectBlocked("http://printer.local/hook");
  });
});

describe("assertPublicUrl — private IPv4 literals", () => {
  it("rejects loopback, private, link-local and CGNAT ranges", () => {
    expectBlocked("http://127.0.0.1/hook");
    expectBlocked("http://10.0.0.1/hook");
    expectBlocked("http://192.168.1.1/hook");
    expectBlocked("http://169.254.169.254/latest/meta-data/");
    expectBlocked("http://172.16.0.1/hook");
    expectBlocked("http://100.64.0.1/hook");
  });

  it("covers range boundaries", () => {
    expectBlocked("http://172.31.255.255/hook"); // last 172.16/12 address
    expectBlocked("http://100.127.255.1/hook"); // last CGNAT address
    expectBlocked("http://0.1.2.3/hook"); // 0.0.0.0/8
    expectBlocked("http://0.0.0.0/");
    expect(() => assertPublicUrl("http://11.0.0.1/hook")).not.toThrow(); // outside all ranges
  });

  it("allows public IPv4 literals", () => {
    expect(() => assertPublicUrl("http://93.184.216.34/hook")).not.toThrow();
    expect(() => assertPublicUrl("http://172.32.0.1/hook")).not.toThrow(); // just outside 172.16/12
    expect(() => assertPublicUrl("http://100.128.0.1/hook")).not.toThrow(); // just outside CGNAT
  });
});

describe("assertPublicUrl — IPv6 literals", () => {
  it("rejects loopback and private/link-local ranges (isPrivateIp ranges)", () => {
    expectBlocked("http://[::1]/hook");
    expectBlocked("http://[fc00::1]/hook");
    expectBlocked("http://[fd12:3456:789a::1]/hook");
    expectBlocked("http://[fe80::1]/hook");
  });

  it("blocks IPv4-mapped literals in BOTH notations (fixed in v1.2.2)", () => {
    // WHATWG URL canonicalizes http://[::ffff:127.0.0.1]/ to [::ffff:7f00:1].
    // Since v1.2.2 every ::ffff:* form (dotted or hex) is decoded to its IPv4
    // address and checked against the private-range rules.
    expectBlocked("http://[::ffff:127.0.0.1]/hook");
    expectBlocked("http://[::ffff:10.0.0.1]/hook");
    expectBlocked("http://[::ffff:192.168.1.1]/hook");
    expectBlocked("http://[::ffff:7f00:1]/hook"); // hex form of 127.0.0.1
    expectBlocked("http://[::ffff:a00:1]/hook"); // hex form of 10.0.0.1
    expect(() => assertPublicUrl("http://[::ffff:93.184.216.34]/hook")).not.toThrow(); // public mapped → ok
  });

  it("isPrivateIp — hex mapped forms decode correctly", () => {
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true); // 127.0.0.1
    expect(isPrivateIp("::ffff:a00:1")).toBe(true); // 10.0.0.1
    expect(isPrivateIp("::ffff:c0a8:101")).toBe(true); // 192.168.1.1
    expect(isPrivateIp("::ffff:5db8:d822")).toBe(false); // 93.184.216.34
    expect(isPrivateIp("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
    expect(isPrivateIp("93.184.216.34")).toBe(false);
    expect(isPrivateIp("127.0.0.1")).toBe(true);
  });

  it("allows public IPv6 literals", () => {
    expect(() => assertPublicUrl("http://[2606:2800:220:1:248:1893:25c8:1946]/hook")).not.toThrow();
  });
});

describe("assertPublicUrl — misc", () => {
  it("tolerates a trailing dot on a public hostname", () => {
    expect(() => assertPublicUrl("http://example.com./hook")).not.toThrow();
  });
});
