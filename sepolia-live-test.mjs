#!/usr/bin/env node
/**
 * Sepolia live payment test against the deployed API.
 *
 * Runs a real x402 round: 402 → sign USDC payment (Base Sepolia) → 200.
 *
 * Setup:
 *   1. Create a THROWAWAY testnet wallet (never reuse a real key):
 *        node -e "const {generatePrivateKey,privateKeyToAccount}=require('viem/accounts');const k=generatePrivateKey();console.log(k, privateKeyToAccount(k).address)"
 *   2. Fund it with Base Sepolia ETH (gasless payments usually don't need it,
 *      but harmless) and Base Sepolia USDC:
 *        https://faucet.circle.com  (select Base Sepolia)
 *   3. Run:
 *        PRIVATE_KEY=0x... node scripts/sepolia-live-test.mjs
 *   4. Optional custom target:
 *        BASE_URL=https://businessdayapi.com PRIVATE_KEY=0x... node scripts/sepolia-live-test.mjs
 */
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const BASE_URL = process.env.BASE_URL || "https://businessdayapi-production.up.railway.app";
const KEY = process.env.PRIVATE_KEY;
if (!KEY || !/^0x[0-9a-fA-F]{64}$/.test(KEY)) {
  console.error("Set PRIVATE_KEY=0x… (throwaway Base-Sepolia test wallet). See header comment.");
  process.exit(1);
}

const account = privateKeyToAccount(KEY);
console.log(`payer:  ${account.address}`);
console.log(`target: ${BASE_URL}`);

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:84532", client: new ExactEvmScheme(account) }],
});

const url = `${BASE_URL}/v1/check?date=2026-06-04&country=DE&region=BY`;
console.log(`\nGET ${url}`);
const res = await fetchWithPayment(url);
console.log(`HTTP ${res.status}`);

const settle = res.headers.get("payment-response");
if (settle) {
  const decoded = decodePaymentResponseHeader(settle);
  console.log("settlement:", JSON.stringify(decoded, null, 2));
}
console.log("body:", JSON.stringify(await res.json(), null, 2));

if (res.status === 200) {
  console.log("\n✅ Full x402 round succeeded — payment settled on Base Sepolia.");
  console.log("   Check the tx on https://sepolia.basescan.org against payTo wallet.");
} else {
  console.log("\n❌ Expected 200 — inspect output above.");
  process.exit(1);
}
