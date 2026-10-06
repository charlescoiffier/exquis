import { createHmac, timingSafeEqual } from "node:crypto";

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

/** exp en secondes epoch */
export function signToken(key: string, exp: number, secret: string): string {
  const payload = b64(JSON.stringify({ key, exp }));
  return `${payload}.${mac(payload, secret)}`;
}

export function verifyToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = mac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { key, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof key === "string" && typeof exp === "number" && exp >= nowSeconds ? key : null;
  } catch {
    return null;
  }
}
