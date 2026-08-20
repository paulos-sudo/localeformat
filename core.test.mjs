import { test } from "node:test";
import assert from "node:assert/strict";
import { currency, number, datetime, rules, verify, locales, ApiError } from "../src/core.js";

// ---------- currency: five very different rule systems ----------
test("de-DE: symbol suffix, comma decimal", () => {
  const r = currency({ amount: "1234.56", currency: "EUR", locale: "de-DE" });
  assert.equal(r.formatted.replace(/ /g, " "), "1.234,56 €");
  assert.equal(r.parts.symbolPosition, "suffix");
  assert.equal(r.parts.decimalSeparator, ",");
});

test("de-CH: apostrophe grouping, symbol prefix", () => {
  const r = currency({ amount: "1234.56", currency: "CHF", locale: "de-CH" });
  assert.ok(r.formatted.includes("’") || r.formatted.includes("'"));
  assert.equal(r.parts.symbolPosition, "prefix");
});

test("en-IN: lakh grouping (1,00,000)", () => {
  const r = currency({ amount: "100000", currency: "INR", locale: "en-IN" });
  assert.ok(r.formatted.includes("1,00,000"), r.formatted);
});

test("ja-JP: JPY has zero fraction digits", () => {
  const r = currency({ amount: "1234.56", currency: "JPY", locale: "ja-JP" });
  assert.equal(r.parts.fractionDigits, 0);
  assert.ok(!r.formatted.includes("."));
});

test("ar-EG: arabic-indic digits", () => {
  const r = number({ value: "1234.56", locale: "ar-EG" });
  assert.ok(/[٠-٩]/.test(r.formatted), r.formatted);
  assert.equal(r.numberingSystem, "arab");
});

// ---------- number ----------
test("en-IN plain number uses lakh grouping too", () => {
  const r = number({ value: "1234567.89", locale: "en-IN" });
  assert.ok(r.formatted.startsWith("12,34,567"), r.formatted);
});

test("percent style", () => {
  const r = number({ value: "0.155", locale: "de-DE", style: "percent", digits: "1" });
  assert.ok(r.formatted.includes("15,5"), r.formatted);
});

// ---------- datetime ----------
test("date order differs: de-DE dd.mm.yyyy vs en-US m/d/yy", () => {
  const de = datetime({ iso: "2026-12-31", locale: "de-DE", dateStyle: "short" });
  const us = datetime({ iso: "2026-12-31", locale: "en-US", dateStyle: "short" });
  assert.equal(de.formatted, "31.12.26");
  assert.equal(us.formatted, "12/31/26");
});

test("timeZone is applied", () => {
  const r = datetime({ iso: "2026-08-19T12:00:00Z", locale: "de-DE", timeStyle: "short", dateStyle: "short", timeZone: "Europe/Berlin" });
  assert.ok(r.formatted.includes("14:00"), r.formatted);
});

// ---------- rules ----------
test("rules de-CH vs de-DE differ in separators", () => {
  const ch = rules({ locale: "de-CH" });
  const de = rules({ locale: "de-DE" });
  assert.notEqual(ch.groupSeparator, de.groupSeparator);
  assert.equal(de.decimalSeparator, ",");
  assert.equal(ch.decimalSeparator, ".");
  assert.equal(de.dateOrder, "day-month-year");
});

test("rules en-IN grouping sizes [3,2]", () => {
  const r = rules({ locale: "en-IN" });
  assert.deepEqual(r.groupingSizes.slice(0, 2), [3, 2]);
});

// ---------- verify: the USP ----------
test("verify accepts a correct string (NBSP-tolerant)", () => {
  const r = verify({ type: "currency", formatted: "1.234,56 €", amount: "1234.56", currency: "EUR", locale: "de-DE" });
  assert.equal(r.valid, true);
});

test("verify catches typical LLM mistake: US separators in de-DE", () => {
  const r = verify({ type: "currency", formatted: "€1,234.56", amount: "1234.56", currency: "EUR", locale: "de-DE" });
  assert.equal(r.valid, false);
  assert.ok(r.differences.length >= 1);
  assert.ok(r.expected.length > 0);
});

test("verify catches wrong symbol side in de-CH", () => {
  const r = verify({ type: "currency", formatted: "1'234.56 CHF", amount: "1234.56", currency: "CHF", locale: "de-CH" });
  assert.equal(r.valid, false);
});

// ---------- meta / contract ----------
test("responses carry source with CLDR version and resolvedLocale", () => {
  const r = currency({ amount: "1", currency: "USD", locale: "en" });
  assert.match(r.source, /CLDR \d+/);
  assert.ok(r.resolvedLocale);
  assert.ok(r.verifiedAt);
});

// ---------- errors with hints ----------
test("underscore locale 'de_CH' is tolerantly normalized to de-CH", () => {
  const r = currency({ amount: "1234.56", currency: "CHF", locale: "de_CH" });
  assert.equal(r.input.locale, "de-CH");
  assert.equal(r.parts.symbolPosition, "prefix");
});

test("unknown currency yields 400", () => {
  try {
    currency({ amount: "1", currency: "EUX", locale: "de-DE" });
    assert.fail("should throw");
  } catch (e) {
    assert.equal(e.status, 400);
  }
});

test("unsupported locale yields 404 with hint", () => {
  try {
    number({ value: "1", locale: "xx-XX" });
    assert.fail("should throw");
  } catch (e) {
    assert.equal(e.status, 404);
    assert.ok(e.hint);
  }
});

test("invalid iso yields 400", () => {
  try {
    datetime({ iso: "31.12.2026", locale: "de-DE" });
    assert.fail("should throw");
  } catch (e) {
    assert.equal(e.status, 400);
    assert.match(e.hint, /ISO 8601|2026/);
  }
});

// ---------- locales (free) ----------
test("locales list is substantial", () => {
  const r = locales();
  assert.ok(r.count > 80, `expected >80 locales, got ${r.count}`);
  assert.ok(r.locales.includes("de-CH"));
});
