# Locale Format API

**Verified, CLDR-versioned locale formatting for ~700 locales** — currency amounts,
numbers, dates and the raw rules, plus a `/verify` endpoint that checks YOUR formatted
string against the canonical CLDR output.

Payable per request via [x402](https://x402.org) — $0.001 in USDC on Base. No account,
no API key. Every response carries the CLDR/ICU version (`source`) for auditability.

| Endpoint | What it does | Price |
|---|---|---|
| `GET /v1/currency?amount&currency&locale[&display]` | Format a currency amount | $0.001 |
| `GET /v1/number?value&locale[&style][&digits]` | Format a number/percent | $0.001 |
| `GET /v1/datetime?iso&locale[&dateStyle][&timeStyle][&timeZone]` | Format a date/time | $0.001 |
| `GET /v1/rules?locale[&currency]` | Raw CLDR rules (separators, symbol position, date order …) | $0.001 |
| `GET /v1/verify?type&formatted&locale&…` | Verify your own formatting, get expected + differences | $0.001 |
| `GET /v1/locales`, `GET /openapi.json`, `GET /health` | Discovery | free |

Why it exists: LLMs guess at exotic locales (de-CH apostrophes, en-IN lakh grouping,
Arabic-Indic digits, JPY's zero decimals) — this API answers deterministically from
the same CLDR data that powers every phone, versioned and verifiable.

## Run locally
```bash
npm install && npm test        # 20 golden tests
bash scripts/smoke-test.sh     # offline e2e: 402 → pay (mock facilitator) → 200
```

## Deploy (Railway)
Env: `PAY_TO`, `NETWORK` (`eip155:84532` testnet → `eip155:8453` mainnet),
`CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` (mainnet). Node pinned to 22 (.nvmrc) —
output is deterministic per ICU version, which every response discloses.
