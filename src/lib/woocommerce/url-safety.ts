import { lookup } from "dns/promises";
import net from "net";
import { AppError } from "../errors";

/**
 * The server calls the store URL an admin typed, so it must not be turned into a way to reach internal services
 * (SSRF). Hosts that are, or resolve to, loopback / private / link-local addresses are rejected unless
 * WOOCOMMERCE_ALLOW_PRIVATE_HOSTS=true (local WordPress during development).
 */

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast / reserved
  );
}

function isPrivateIPv6(ip: string): boolean {
  const value = ip.toLowerCase();
  if (value === "::1" || value === "::") return true;
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80")) return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  // new URL() rewrites IPv4-mapped addresses to hex: ::ffff:a00:1 = 10.0.0.1
  const hex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true;
}

export async function assertPublicStoreHost(storeUrl: string): Promise<void> {
  if (process.env.WOOCOMMERCE_ALLOW_PRIVATE_HOSTS === "true") return;
  const hostname = new URL(storeUrl).hostname.replace(/^\[|\]$/g, "");
  const reject = () =>
    new AppError("WOOCOMMERCE_INVALID_STORE_URL", {
      message: "This address points to a private network. Enter your store's public address.",
      details: { reason: "private_host" },
      expected: true,
    });

  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw reject();
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw reject();
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new AppError("WOOCOMMERCE_STORE_UNREACHABLE", {
      message: `We couldn't find ${hostname}. Check the store address.`,
      details: { reason: "dns_failed" },
      expected: true,
    });
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) throw reject();
}
