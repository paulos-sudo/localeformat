/**
 * Locale Format API — x402-payable Express server.
 * Env: PAY_TO, NETWORK (eip155:84532 testnet | eip155:8453 mainnet),
 *      FACILITATOR_URL (testnet default), CDP_API_KEY_ID/SECRET (mainnet), PRICE, PORT.
 */
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import { declareDiscoveryExtension, bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { currency, number, datetime, rules, verify, locales, ApiError, SOURCE, VERIFIED_AT } from "./core.js";

const PAY_TO = process.env.PAY_TO || "0xE72b85A97A6e19413D8b80633787Eda6d6237A77";
const NETWORK = process.env.NETWORK || "eip155:84532";
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://x402.org/facilitator";
const PRICE = process.env.PRICE || "$0.001";
const PORT = Number(process.env.PORT || 4022);

const DISCLAIMER = "Formatting per CLDR conventions — informational, not legal advice.";

const app = express();

const facilitatorConfig =
  process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET
    ? createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET)
    : { url: FACILITATOR_URL };
const facilitator = new HTTPFacilitatorClient(facilitatorConfig);
const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, new ExactEvmScheme());
resourceServer.registerExtension(bazaarResourceServerExtension);

const accepts = { scheme: "exact", price: PRICE, network: NETWORK, payTo: PAY_TO };
const TAGS = ["data", "i18n", "formatting", "localization", "verification"];
const LOCALE_DESC = "BCP 47 locale tag, e.g. de-DE, de-CH, en-IN, ja-JP, ar-EG";

const route = (description, input, inputSchema, outputExample) => ({
  accepts,
  serviceName: "Locale Format API",
  description,
  mimeType: "application/json",
  tags: TAGS,
  extensions: declareDiscoveryExtension({
    method: "GET",
    input,
    inputSchema,
    output: { example: outputExample },
  }),
});

const routes = {
  "GET /v1/currency": route(
    "Format a currency amount for any of ~700 locales per official CLDR rules (symbol position, separators, fraction digits — e.g. de-CH apostrophe grouping, en-IN lakh grouping, ja-JP zero decimals). Verified, CLDR-versioned output.",
    { amount: 1234.56, currency: "EUR", locale: "de-DE" },
    {
      properties: {
        amount: { type: "number", description: "amount (use '.' as decimal separator in input)" },
        currency: { type: "string", description: "ISO 4217 code, e.g. EUR, CHF, JPY" },
        locale: { type: "string", description: LOCALE_DESC },
        display: { type: "string", description: "symbol | narrowSymbol | code | name (default symbol)" },
      },
      required: ["amount", "currency", "locale"],
    },
    { formatted: "1.234,56 €", parts: { symbolPosition: "suffix", decimalSeparator: ",", groupSeparator: ".", fractionDigits: 2 }, source: "CLDR 48.0 / ICU 78.2 / Node 22", resolvedLocale: "de-DE" },
  ),
  "GET /v1/number": route(
    "Format a number or percentage for any locale per CLDR (grouping, separators, numbering system — incl. Indian lakh grouping and Arabic-Indic digits).",
    { value: 1234567.89, locale: "en-IN" },
    {
      properties: {
        value: { type: "number" },
        locale: { type: "string", description: LOCALE_DESC },
        style: { type: "string", description: "decimal | percent" },
        digits: { type: "integer", description: "fixed fraction digits 0-20" },
      },
      required: ["value", "locale"],
    },
    { formatted: "12,34,567.89", numberingSystem: "latn", resolvedLocale: "en-IN" },
  ),
  "GET /v1/datetime": route(
    "Format an ISO date/time for any locale per CLDR (date order, month names, 12/24h, optional IANA time zone).",
    { iso: "2026-12-31", locale: "de-DE", dateStyle: "short" },
    {
      properties: {
        iso: { type: "string", description: "ISO 8601 date or datetime" },
        locale: { type: "string", description: LOCALE_DESC },
        dateStyle: { type: "string", description: "full | long | medium | short" },
        timeStyle: { type: "string", description: "full | long | medium | short" },
        timeZone: { type: "string", description: "IANA zone, e.g. Europe/Berlin" },
      },
      required: ["iso", "locale"],
    },
    { formatted: "31.12.26", hourCycle: "h23", resolvedLocale: "de-DE" },
  ),
  "GET /v1/rules": route(
    "Raw formatting rules for a locale as JSON: decimal/group separators, grouping sizes, currency symbol+position, date field order, first day of week, numbering system, hour cycle — with examples.",
    { locale: "de-CH" },
    {
      properties: {
        locale: { type: "string", description: LOCALE_DESC },
        currency: { type: "string", description: "optional ISO 4217 code for currency rules (default USD)" },
      },
      required: ["locale"],
    },
    { decimalSeparator: ".", groupSeparator: "’", currencyPosition: "prefix", dateOrder: "day-month-year", firstDayOfWeek: 1, resolvedLocale: "de-CH" },
  ),
  "GET /v1/verify": route(
    "Verify YOUR OWN formatted string against the canonical CLDR output for a locale — returns valid true/false, the expected string and the differences. Use this to double-check LLM-generated invoices, contracts and documents before sending.",
    { type: "currency", formatted: "€1,234.56", amount: 1234.56, currency: "EUR", locale: "de-DE" },
    {
      properties: {
        type: { type: "string", description: "currency | number | datetime" },
        formatted: { type: "string", description: "the string to verify" },
        amount: { type: "number", description: "for type=currency" },
        currency: { type: "string", description: "for type=currency" },
        value: { type: "number", description: "for type=number" },
        iso: { type: "string", description: "for type=datetime" },
        locale: { type: "string", description: LOCALE_DESC },
      },
      required: ["type", "formatted", "locale"],
    },
    { valid: false, expected: "1.234,56 €", differences: ["currency symbol on the wrong side (locale uses suffix)"], resolvedLocale: "de-DE" },
  ),
};

app.use(paymentMiddleware(routes, resourceServer));

const wrap = (fn) => (req, res) => {
  try {
    res.json({ ...fn(req.query), disclaimer: DISCLAIMER });
  } catch (e) {
    if (e instanceof ApiError) res.status(e.status).json({ error: e.code, message: e.message, hint: e.hint });
    else res.status(500).json({ error: "internal", message: "Unexpected error." });
  }
};

app.get("/v1/currency", wrap(currency));
app.get("/v1/number", wrap(number));
app.get("/v1/datetime", wrap(datetime));
app.get("/v1/rules", wrap(rules));
app.get("/v1/verify", wrap(verify));

// ---- free ----
app.get("/v1/locales", (_req, res) => res.json(locales()));
app.get("/health", (_req, res) => res.json({ status: "ok", source: SOURCE, verifiedAt: VERIFIED_AT }));

// OpenAPI 3.1 per x402scan discovery spec
const QP = (name, desc, required = false, type = "string") => ({ name, in: "query", required, description: desc, schema: { type } });
const PAYMENT_INFO = { price: { mode: "fixed", currency: "USD", amount: "0.001000" }, protocols: [{ x402: {} }] };
const R402 = { 402: { description: "Payment Required" } };
const ok = (props, required) => ({
  200: { description: "Successful response", content: { "application/json": { schema: { type: "object", properties: props, required } } } },
});
const METpaths = {
  formatted: { type: "string" }, resolvedLocale: { type: "string" }, source: { type: "string" }, verifiedAt: { type: "string" },
};

app.get("/openapi.json", (_req, res) => {
  res.json({
    openapi: "3.1.0",
    info: {
      title: "Locale Format API",
      version: "0.1.0",
      description: `Verified, CLDR-versioned locale formatting for ~700 locales: currency amounts, numbers, dates and the raw rules — plus a verify endpoint to check your own output. ${DISCLAIMER}`,
      "x-guidance":
        "All endpoints are GET with query parameters, $0.001 each via x402 (USDC on Base). Use /v1/currency, /v1/number, /v1/datetime to format values for a BCP 47 locale (de-DE, de-CH, en-IN, ja-JP, ar-EG …); /v1/rules for a locale's raw conventions (separators, symbol position, date order); /v1/verify to check a string YOU formatted against the canonical CLDR output before putting it in an invoice or document. Every response carries the CLDR/ICU version (source) for auditability. GET /v1/locales and /health are free.",
      contact: { email: "paulos@voiceagenten.com" },
    },
    paths: {
      "/v1/currency": { get: { operationId: "formatCurrency", summary: "Format a currency amount per CLDR for a locale", tags: ["Format"], "x-payment-info": PAYMENT_INFO,
        parameters: [QP("amount", "amount, '.' as decimal separator", true, "number"), QP("currency", "ISO 4217 code", true), QP("locale", LOCALE_DESC, true), QP("display", "symbol|narrowSymbol|code|name")],
        responses: { ...ok({ ...METpaths, parts: { type: "object" } }, ["formatted"]), ...R402 } } },
      "/v1/number": { get: { operationId: "formatNumber", summary: "Format a number/percent per CLDR for a locale", tags: ["Format"], "x-payment-info": PAYMENT_INFO,
        parameters: [QP("value", "the number", true, "number"), QP("locale", LOCALE_DESC, true), QP("style", "decimal|percent"), QP("digits", "0-20", false, "integer")],
        responses: { ...ok({ ...METpaths, numberingSystem: { type: "string" } }, ["formatted"]), ...R402 } } },
      "/v1/datetime": { get: { operationId: "formatDatetime", summary: "Format an ISO date/time per CLDR for a locale", tags: ["Format"], "x-payment-info": PAYMENT_INFO,
        parameters: [QP("iso", "ISO 8601 date/datetime", true), QP("locale", LOCALE_DESC, true), QP("dateStyle", "full|long|medium|short"), QP("timeStyle", "full|long|medium|short"), QP("timeZone", "IANA zone")],
        responses: { ...ok({ ...METpaths, hourCycle: { type: ["string", "null"] } }, ["formatted"]), ...R402 } } },
      "/v1/rules": { get: { operationId: "localeRules", summary: "Raw CLDR formatting rules for a locale", tags: ["Rules"], "x-payment-info": PAYMENT_INFO,
        parameters: [QP("locale", LOCALE_DESC, true), QP("currency", "ISO 4217 for currency rules (default USD)")],
        responses: { ...ok({ decimalSeparator: { type: ["string", "null"] }, groupSeparator: { type: ["string", "null"] }, currencyPosition: { type: "string" }, dateOrder: { type: "string" }, firstDayOfWeek: { type: ["integer", "null"] }, resolvedLocale: { type: "string" } }, ["decimalSeparator"]), ...R402 } } },
      "/v1/verify": { get: { operationId: "verifyFormatting", summary: "Verify your own formatted string against canonical CLDR output", tags: ["Verify"], "x-payment-info": PAYMENT_INFO,
        parameters: [QP("type", "currency|number|datetime", true), QP("formatted", "string to verify", true), QP("locale", LOCALE_DESC, true), QP("amount", "for type=currency", false, "number"), QP("currency", "for type=currency"), QP("value", "for type=number", false, "number"), QP("iso", "for type=datetime")],
        responses: { ...ok({ valid: { type: "boolean" }, expected: { type: "string" }, differences: { type: "array", items: { type: "string" } } }, ["valid", "expected"]), ...R402 } } },
      "/v1/locales": { get: { operationId: "listLocales", summary: "Free list of supported locales", responses: ok({ count: { type: "integer" }, locales: { type: "array", items: { type: "string" } } }, ["locales"]) } },
      "/health": { get: { operationId: "health", summary: "Free health + CLDR version check", responses: ok({ status: { type: "string" }, source: { type: "string" } }, ["status"]) } },
    },
  });
});

app.listen(PORT, () => {
  console.log(`localeformat listening on :${PORT} — network=${NETWORK} payTo=${PAY_TO} source=${SOURCE}`);
});
