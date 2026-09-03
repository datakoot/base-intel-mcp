/**
 * Datakoot Base Intel MCP -- read-only on-chain intelligence for AI agents (Base). Keyless.
 * Bindings: KV "RL" (licence-key cache), D1 "QUOTA_DB" (call counter).
 */
const RPCS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org", "https://1rpc.io/base", "https://base-mainnet.public.blastapi.io"]; let RPC_CURSOR = 0;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SERVER_INFO = { name: "base-intel", version: "2.0.0" };
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization" };
class ToolError extends Error {}
async function rpc(method, params) {
  const cache = caches.default;
  const ckey = new Request("https://base-rpc-cache.datakoot/" + encodeURIComponent(method) + "?p=" + encodeURIComponent(JSON.stringify(params || [])), { method: "GET" });
  const hit = await cache.match(ckey); if (hit) { try { return await hit.json(); } catch (e) {} }
  const n = await dkUpstreamCount(DK_BASE_UP);
  if (n !== null && n > DK_BASE_UP.limit) throw new ToolError("Base RPC is briefly at its fair-use limit on our side to protect the shared public nodes \u2014 retry in a few seconds.");
  let lastErr = "no rpc";
  for (let i = 0; i < RPCS.length + 2; i++) {
    try {
      const r = await fetch(RPCS[(RPC_CURSOR + i) % RPCS.length], { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (!r.ok) { lastErr = "HTTP " + r.status; continue; }
      const j = await r.json();
      if (j.error) { lastErr = j.error.message || "rpc error"; continue; }
      RPC_CURSOR = (RPC_CURSOR + i) % RPCS.length;
      try { await cache.put(ckey, new Response(JSON.stringify(j.result === undefined ? null : j.result), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=" + DK_RPC_TTL } })); } catch (e) {}
      return j.result;
    } catch (e) { lastErr = String((e && e.message) || e); }
  }
  throw new ToolError("Base RPC unavailable: " + lastErr);
}
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || ""));
const isHash = (h) => /^0x[0-9a-fA-F]{64}$/.test(String(h || ""));
const hexBig = (h) => (h && h !== "0x" ? BigInt(h) : 0n);
function padAddr(a) { return String(a).toLowerCase().replace(/^0x/, "").padStart(64, "0"); }
function formatUnits(raw, decimals) {
  raw = BigInt(raw);
  const d = 10n ** BigInt(decimals);
  const whole = raw / d;
  let frac = (raw % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? whole.toString() + "." + frac : whole.toString();
}
function decodeAbiString(hex) {
  if (!hex || hex.length < 130) return null;
  const h = hex.slice(2);
  const len = parseInt(h.slice(64, 128), 16);
  if (!len) return null;
  const dataHex = h.slice(128, 128 + len * 2);
  let s = "";
  for (let i = 0; i < dataHex.length; i += 2) s += String.fromCharCode(parseInt(dataHex.slice(i, i + 2), 16));
  return s;
}
async function ethCall(to, data) { return await rpc("eth_call", [{ to, data }, "latest"]); }
async function addressReport(address) {
  if (!isAddr(address)) throw new ToolError("Invalid address. Expected 0x + 40 hex chars.");
  const parts = await Promise.all([ rpc("eth_getBalance", [address, "latest"]), rpc("eth_getCode", [address, "latest"]), rpc("eth_getTransactionCount", [address, "latest"]), ethCall(USDC, "0x70a08231" + padAddr(address)) ]);
  return { address, network: "base-mainnet", eth_balance: formatUnits(hexBig(parts[0]), 18), usdc_balance: formatUnits(hexBig(parts[3]), 6), tx_count: Number(hexBig(parts[2])), is_contract: Boolean(parts[1] && parts[1] !== "0x") };
}
async function tokenInfo(token) {
  if (!isAddr(token)) throw new ToolError("Invalid token address.");
  const p = await Promise.all([ ethCall(token, "0x06fdde03").catch(() => null), ethCall(token, "0x95d89b41").catch(() => null), ethCall(token, "0x313ce567").catch(() => null), ethCall(token, "0x18160ddd").catch(() => null) ]);
  // An empty "0x" response is truthy but means "no such method here". Treat it
  // as absent so a wallet or non-token contract is not reported as a token with
  // 0 decimals and 0 supply.
  const nz = function (x) { return (x && x !== "0x") ? x : null; };
  const name = decodeAbiString(p[0]);
  const symbol = decodeAbiString(p[1]);
  const decimals = nz(p[2]) != null ? Number(hexBig(p[2])) : null;
  const total_supply = (nz(p[3]) != null && decimals != null) ? formatUnits(hexBig(p[3]), decimals) : null;
  if (!name && !symbol && nz(p[3]) == null) {
    return { token, network: "base-mainnet", is_erc20: false,
      note: "No ERC-20 token found at this address. It returned no name, symbol or total supply, so it is probably a wallet or a non-token contract rather than a token." };
  }
  return { token, network: "base-mainnet", is_erc20: true, name: name, symbol: symbol, decimals: decimals, total_supply: total_supply };
}
async function tokenBalance(token, address) {
  if (!isAddr(token)) throw new ToolError("Invalid token address.");
  if (!isAddr(address)) throw new ToolError("Invalid holder address.");
  const p = await Promise.all([ ethCall(token, "0x70a08231" + padAddr(address)), ethCall(token, "0x313ce567").catch(() => null), ethCall(token, "0x95d89b41").catch(() => null) ]);
  const decimals = p[1] ? Number(hexBig(p[1])) : 18;
  return { token, holder: address, network: "base-mainnet", symbol: decodeAbiString(p[2]), balance: formatUnits(hexBig(p[0]), decimals), balance_raw: hexBig(p[0]).toString(), decimals };
}
async function gasNow() { const gp = await rpc("eth_gasPrice", []); const wei = hexBig(gp); return { network: "base-mainnet", gas_price_wei: wei.toString(), gas_price_gwei: formatUnits(wei, 9) }; }
async function txStatus(hash) {
  if (!isHash(hash)) throw new ToolError("Invalid tx hash. Expected 0x + 64 hex chars.");
  const p = await Promise.all([ rpc("eth_getTransactionByHash", [hash]), rpc("eth_getTransactionReceipt", [hash]) ]);
  const tx = p[0], receipt = p[1];
  if (!tx) return { hash, found: false };
  return { hash, found: true, network: "base-mainnet", from: tx.from, to: tx.to, value_eth: formatUnits(hexBig(tx.value), 18), block_number: tx.blockNumber ? Number(hexBig(tx.blockNumber)) : null, status: receipt ? (hexBig(receipt.status) === 1n ? "success" : "failed") : "pending", gas_used: receipt ? Number(hexBig(receipt.gasUsed)) : null };
}
const DK_AD = {"*.token":"ERC-20 contract address on Base: 0x followed by 40 hex characters.","token_balance.address":"Wallet address whose balance to read: 0x followed by 40 hex characters.","tx_status.hash":"Transaction hash on Base: 0x followed by 64 hex characters."};
function dkDescribe(ts) { try { for (const t of ts) { const p = ((t.inputSchema || {}).properties) || {}; for (const k of Object.keys(p)) { const d = DK_AD[t.name + "." + k] || DK_AD["*." + k]; if (d && p[k] && !p[k].description) p[k].description = d; } } } catch (e) {} return ts; }
const TOOL_DEFS = [
  { name: "address_report", description: "One-call snapshot of a Base address: ETH balance, USDC balance, tx count, and whether it is a contract.", inputSchema: { type: "object", properties: { address: { type: "string", description: "0x address on Base" } }, required: ["address"] } },
  { name: "token_info", description: "ERC-20 token metadata on Base: name, symbol, decimals, total supply.", inputSchema: { type: "object", properties: { token: { type: "string" } }, required: ["token"] } },
  { name: "token_balance", description: "ERC-20 token balance of a holder on Base (formatted + raw).", inputSchema: { type: "object", properties: { token: { type: "string" }, address: { type: "string" } }, required: ["token", "address"] } },
  { name: "gas_now", description: "Current Base network gas price (gwei and wei).", inputSchema: { type: "object", properties: {} } },
  { name: "tx_status", description: "Look up a Base transaction by hash: status, from, to, value, block, gas used.", inputSchema: { type: "object", properties: { hash: { type: "string" } }, required: ["hash"] } },
];
async function runTool(name, a) {
  if (name === "address_report") return await addressReport(a.address);
  if (name === "token_info") return await tokenInfo(a.token);
  if (name === "token_balance") return await tokenBalance(a.token, a.address);
  if (name === "gas_now") return await gasNow();
  if (name === "tx_status") return await txStatus(a.hash);
  throw new ToolError("Unknown tool: " + name);
}
const rpcOk = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcErrM = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
const LANDING = "<!doctype html><meta charset=utf-8><title>Datakoot Base Intel MCP</title><style>body{font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;background:#0b0e14;color:#e6e9ef}code{background:#131722;padding:2px 6px;border-radius:5px}a{color:#22d3ee}h1{color:#4ade80}</style><h1>Base Intel &mdash; MCP</h1><p>Read-only on-chain intelligence for AI agents, on <b>Base</b>. No API keys.</p><p><b>Endpoint:</b> <code>POST /mcp</code></p><p><b>Tools:</b> <code>address_report</code>, <code>token_info</code>, <code>token_balance</code>, <code>gas_now</code>, <code>tx_status</code>.</p><p>Part of <a href=https://datakoot.com>Datakoot</a>.</p>";
const CTA_HTML = "<div style=\"max-width:760px;margin:24px auto;padding:16px 20px;border:1px solid #22d3ee55;border-radius:10px;background:#0f1420;font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#e6e9ef\"><b style=\"color:#4ade80\">Pro &mdash; $15/mo</b> &middot; one key unlocks <b>all nine</b> Datakoot servers and includes 10,000 calls a month; past that it is $5 per 1,000, capped at $100. Free stays free: 100 calls a day, no key, no signup. <a href=\"https://datakoot.com/pricing\" style=\"color:#22d3ee\">See pricing &rarr;</a></div>";

/* ------------------------------------------------- quota: D1 (atomic) ----
 * The free-tier counter used to live in KV. KV caches reads at the edge and
 * is eventually consistent, so a read-modify-write counter loses increments
 * under any real concurrency - measured against production on 2026-08-29:
 * seven consecutive calls moved the counter by three, and once backwards.
 * D1 does the read, the increment and the return in one statement, inside one
 * transaction, so no increment can be lost. Proven on security-intel:
 * 731 calls fired, 731 counted, every call past 100 refused.
 * Database "datakoot-quota", binding QUOTA_DB, table:
 *   quota(k TEXT PRIMARY KEY, period TEXT, n INTEGER, updated INTEGER)
 */
const FREE_LIMIT = 100;          // anonymous, keyless, per UTC day
const PRO_INCLUDED = 10000;      // calls included in Pro each month
const OVERAGE_PER = 1000;        // then $5 per 1,000
const CHECKOUT = "https://buy.polar.sh/polar_cl_Q9y3qLrNbtsssN3w5m8SK56oNcruwrmxLEPnd34oAZf";
const POLAR_ORG = "7f455043-0b15-4a1c-b7a0-9c06c9f3b95e";
const BUMP_SQL =
  "INSERT INTO quota (k, period, n, updated) VALUES (?1, ?2, 1, ?3) " +
  "ON CONFLICT(k) DO UPDATE SET " +
  "n = CASE WHEN quota.period = excluded.period THEN quota.n + 1 ELSE 1 END, " +
  "period = excluded.period, updated = excluded.updated RETURNING n";

async function bump(env, k, period) {
  const row = await env.QUOTA_DB.prepare(BUMP_SQL).bind(k, period, Math.floor(Date.now() / 1000)).first();
  const n = row && row.n;
  if (typeof n !== "number") throw new Error("quota: no row returned");
    await dkDaily(env, k, period);
  return n;
}
/* Identify a caller without storing an identity.
 *
 * This is an HMAC, not a plain hash, and the key is a 256-bit secret held only
 * in the Worker's environment (IP_SALT). That distinction matters: a plain
 * SHA-256 of an IPv4 address is reversible by anyone who has the code, because
 * there are only 4.3 billion addresses to try. Keyed, it is not reversible
 * without the secret — which is never stored beside the data it protects.
 *
 * If IP_SALT is ever unset the function still works, unkeyed, so a missing
 * secret degrades privacy rather than taking the service down.
 */
let DK_SALT = null, DK_KEY = null;
// --- Base RPC caching + global breaker ---
// The public Base RPCs rotate across five providers but nothing was cached, so a
// flood hit them live. A 10s cache makes repeated reads free (balances and gas are
// fresh enough at 10s), and a global breaker caps distinct-query pressure. Fails
// open on any D1 problem.
let DK_QDB = null;
const DK_RPC_TTL = 10;
const DK_BASE_UP = { key: "baserpc", win: 10, limit: 100 };
const DK_UP_SQL = "INSERT INTO upstream_rl (k, n, exp) VALUES (?1, 1, ?2) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n";
async function dkUpstreamCount(u) {
  if (!DK_QDB) return null;
  const now = Math.floor(Date.now() / 1000); const bucket = Math.floor(now / u.win);
  try { const row = await DK_QDB.prepare(DK_UP_SQL).bind("up:" + u.key + ":" + bucket, (bucket + 1) * u.win).first();
        return row && typeof row.n === "number" ? row.n : null; }
  catch (e) { return null; }
}
async function dkMacKey() {
  if (!DK_KEY) {
    DK_KEY = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(DK_SALT || "dk1-unsalted"),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  }
  return DK_KEY;
}
async function sha96(s) {
  const b = await crypto.subtle.sign("HMAC", await dkMacKey(), new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join("");
}
/* Headers so a developer can watch the meter instead of guessing. */
function quotaHeaders(a) {
  if (!a || a.pro || a.limit == null) return {};
  const t = new Date();
  return {
    "X-RateLimit-Limit": String(a.limit),
    "X-RateLimit-Remaining": String(a.remaining == null ? a.limit : a.remaining),
    "X-RateLimit-Reset": String(Math.floor(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1) / 1000)),
  };
}
async function checkAccess(request, env) {
  let key = (request.headers.get("Authorization") || "").trim();
  if (key.toLowerCase().indexOf("bearer ") === 0) key = key.slice(7).trim();
  if (!key) key = (request.headers.get("X-Datakoot-Key") || "").trim();

  if (key) {
    let pro = false;
    if (env.RL) { try { if ((await env.RL.get("pk:" + (await sha96("dk1:" + key)))) === "1") pro = true; } catch (e) {} }
    if (!pro) {
      try {
        const vr = await fetch("https://api.polar.sh/v1/customer-portal/license-keys/validate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: key, organization_id: POLAR_ORG }),
        });
        if (vr.ok) { const _pd = await vr.json().catch(() => null); pro = !!(_pd && (!("status" in _pd) || _pd.status === "granted")); if (pro && env.RL) { try { await env.RL.put("pk:" + (await sha96("dk1:" + key)), "1", { expirationTtl: 3600 }); } catch (e) {} } }
      } catch (e) { /* Polar down: fall through to the invalid-key branch */ }
    }
    if (!pro) {
      // A key that does not validate used to fall silently back to the free
      // tier, so a paying customer with a typo looked throttled for no reason.
      return { allowed: false, limit: FREE_LIMIT, remaining: 0,
        message: "That Datakoot API key was not recognised. Check it at https://datakoot.com/pricing, or remove the Authorization header to use the free tier (" + FREE_LIMIT + " calls/day, no signup)." };
    }
    // Pro is metered but never blocked: overage is billed, not refused.
    if (env.QUOTA_DB) {
      try { await bump(env, "pro:" + (await sha96("dk1:" + key)), new Date().toISOString().slice(0, 7)); }
      catch (e) { console.error("QUOTA error (pro):", e && e.message); }
    }
    return { allowed: true, pro: true };
  }

  if (!env.QUOTA_DB) {
    // Fail OPEN so a misconfiguration never takes the API down - but say so.
    console.error("DATAKOOT METERING DISABLED: env.QUOTA_DB is not bound");
    return { allowed: true };
  }
  let n;
  try {
    n = await bump(env, "ip:" + (await sha96("dk1:" + (request.headers.get("CF-Connecting-IP") || "anon"))), new Date().toISOString().slice(0, 10));
  } catch (e) {
    console.error("DATAKOOT METERING ERROR, failing open:", e && e.message);
    return { allowed: true };
  }
  // The Nth call writes n = N, so call FREE_LIMIT is the last one allowed.
  if (n > FREE_LIMIT) return { allowed: false, limit: FREE_LIMIT, remaining: 0,
    message: "Daily free limit reached (" + FREE_LIMIT + " calls). It resets at 00:00 UTC. Datakoot Pro includes " + PRO_INCLUDED.toLocaleString() + " calls a month across all nine servers for $15, then $5 per " + OVERAGE_PER.toLocaleString() + " — " + CHECKOUT };
  return { allowed: true, limit: FREE_LIMIT, remaining: FREE_LIMIT - n };
}

export default {
  async fetch(request, env) {
    if (DK_SALT === null) DK_SALT = env.IP_SALT || "";
    if (DK_QDB === null) DK_QDB = env.QUOTA_DB || false;
    const url = new URL(request.url);
    if (url.pathname.endsWith("/.well-known/owners.json")) return new Response(JSON.stringify({ $schema: "https://verifymcp.io/schemas/owners.json", owners: ["hello@datakoot.com"] }), { headers: { "Content-Type": "application/json" } });
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (url.pathname === "/" && request.method === "GET") return new Response(LANDING + CTA_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", ...CORS } });
    if (url.pathname === "/health") return new Response(JSON.stringify({ ok: true, service: SERVER_INFO.name }), { headers: { "Content-Type": "application/json", ...CORS } });
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404, headers: CORS });
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST", ...CORS } });
    let body;
    try { body = await request.json(); } catch (e) { return json(rpcErrM(null, -32700, "Parse error")); }
    const msg = Array.isArray(body) ? body[0] : body;
    const id = msg && msg.id != null ? msg.id : null;
    const method = msg && msg.method;
    console.log("DKPULSE " + (method || "?") + " " + ((msg && msg.params && msg.params.name) || "-"));
    if (method === "initialize") { const cv = msg.params && msg.params.protocolVersion; const pv = PROTOCOL_VERSIONS.includes(cv) ? cv : PROTOCOL_VERSIONS[0]; return json(rpcOk(id, { protocolVersion: pv, capabilities: { tools: {} }, serverInfo: SERVER_INFO, instructions: "Base Intel: read-only on-chain data for the Base network - address snapshots (ETH and USDC balance, tx count, contract check), ERC-20 token metadata and balances, live gas price, and transaction status. Have a wallet address? Call address_report first for a one-call overview, then token_balance for a specific ERC-20." })); }
    if (method === "notifications/initialized" || method === "notifications/cancelled") return new Response(null, { status: 202, headers: CORS });
    if (method === "ping") return json(rpcOk(id, {}));
    if (method === "tools/list") return json(rpcOk(id, { tools: dkDescribe(TOOL_DEFS) }));
    if (method === "tools/call") {
      const _g = await checkAccess(request, env);
      const _h = quotaHeaders(_g);
      if (!_g.allowed) return json(rpcOk(id, { content: [{ type: "text", text: _g.message }], isError: true }), _h);
      const name = msg.params && msg.params.name;
      const args = (msg.params && msg.params.arguments) || {};
      { const _t = TOOL_DEFS.find((t) => t.name === name); if (!_t) return json(rpcErrM(id, -32602, "Unknown tool: " + name), _h); const _s = (_t.inputSchema || {}).properties || {}; const _rq = (_t.inputSchema || {}).required || []; const _bad = Object.keys(args).filter((k) => !(k in _s)).map((k) => "unexpected '" + k + "'").concat(_rq.filter((k) => args[k] === undefined || args[k] === null || args[k] === "").map((k) => "missing required '" + k + "'")); if (_bad.length) return json(rpcErrM(id, -32602, "Bad arguments for " + name + ": " + _bad.join(", ") + ". Valid: " + (Object.keys(_s).join(", ") || "none") + ". The call was refused rather than ignoring them, because ignoring an argument returns a confident answer to a different question than the one asked."), _h); } const meta = _g.remaining == null ? "" : "\n\n(" + _g.remaining + " free calls left today)";
      try { return json(rpcOk(id, { content: [{ type: "text", text: JSON.stringify(await runTool(name, args), null, 2) + meta }] }), _h); }
      catch (e) { return json(rpcOk(id, { content: [{ type: "text", text: "Error: " + ((e && e.message) || e) }], isError: true }), _h); }
    }
    return json(rpcErrM(id, -32601, "Method not found: " + method));
  },
};
function json(obj, extra) { return new Response(JSON.stringify(obj), { headers: { "Content-Type": "application/json", ...CORS, ...(extra || {}) } }); }

/* Retention analytics.
 *
 * `quota` keeps ONE row per caller and overwrites it when the day rolls over,
 * so it can only ever show a caller's most recent active day. That makes the
 * most valuable question — did anyone come back tomorrow? — structurally
 * unanswerable. `daily` keeps one row per caller PER DAY instead.
 *
 * It stores exactly what `quota` stores: the same keyed, non-reversible caller
 * identifier, a date, a count. No queries, no addresses, nothing new about
 * anyone. The 04:17 retention job prunes it on the same 90-day clock, so the
 * privacy policy stays true.
 *
 * Wrapped so it can never break a caller's request: if this write fails the
 * call still succeeds and metering is unaffected. It is analytics, not billing.
 */
const DK_DAILY_SQL =
  "INSERT INTO daily (k, period, n, updated) VALUES (?1, ?2, 1, ?3) " +
  "ON CONFLICT(k, period) DO UPDATE SET n = daily.n + 1, updated = excluded.updated";
async function dkDaily(env, k, period) {
  try {
    await env.QUOTA_DB.prepare(DK_DAILY_SQL)
      .bind(k, period, Math.floor(Date.now() / 1000)).run();
  } catch (e) { /* never let analytics break a paying or free call */ }
}