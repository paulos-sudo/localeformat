/**
 * Locale-formatting core. Pure functions on top of Node's built-in Intl (full ICU).
 * Determinism is per ICU/CLDR version — captured once and exposed on every response.
 */

export const VERSIONS = {
  node: process.versions.node,
  icu: process.versions.icu,
  cldr: process.versions.cldr,
};
export const SOURCE = `CLDR ${VERSIONS.cldr} / ICU ${VERSIONS.icu} / Node ${VERSIONS.node}`;
export const VERIFIED_AT = new Date().toISOString();

export class ApiError extends Error {
  constructor(status, code, message, hint) {
    super(message);
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

const meta = (resolvedLocale) => ({
  resolvedLocale,
  source: SOURCE,
  verifiedAt: VERIFIED_AT,
});

export function resolveLocale(locale) {
  if (typeof locale !== "string" || !locale.trim()) {
    throw new ApiError(400, "missing_locale", "locale is required (BCP 47, e.g. de-CH).",
      "Examples: de-DE, de-CH, en-IN, ja-JP, ar-EG. GET /v1/locales lists all.");
  }
  let canonical;
  try {
    [canonical] = Intl.getCanonicalLocales(locale.replace(/_/g, "-"));
  } catch {
    throw new ApiError(400, "invalid_locale", `'${locale}' is not a valid BCP 47 locale tag.`,
      locale.includes("_")
        ? `Use hyphens, not underscores: '${locale.replace(/_/g, "-")}'.`
        : "Example: de-CH. GET /v1/locales lists all supported tags.");
  }
  const resolved = new Intl.NumberFormat(canonical).resolvedOptions().locale;
  const requestedBase = canonical.split("-")[0];
  const resolvedBase = resolved.split("-")[0];
  if (requestedBase !== resolvedBase) {
    throw new ApiError(404, "unsupported_locale", `Locale '${canonical}' is not supported by this ICU build.`,
      "GET /v1/locales lists all supported tags.");
  }
  return { canonical, resolved, fallback: canonical !== resolved };
}

function parseNumber(raw, field) {
  const n = Number(raw);
  if (raw === undefined || raw === "" || !Number.isFinite(n)) {
    throw new ApiError(400, "invalid_number", `${field} must be a finite number, got: ${raw}`,
      `Example: ${field}=1234.56 (always use '.' as decimal separator in the INPUT).`);
  }
  if (Math.abs(n) > 1e15) {
    throw new ApiError(422, "out_of_range", `${field} exceeds supported magnitude (1e15).`, undefined);
  }
  return n;
}

function partsSummary(parts) {
  const get = (t) => parts.find((p) => p.type === t)?.value ?? null;
  return {
    decimalSeparator: get("decimal"),
    groupSeparator: get("group"),
    symbol: get("currency"),
  };
}

// ---------- currency ----------
const KNOWN_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));
export function currency({ amount, currency: cur, locale, display }) {
  const loc = resolveLocale(locale);
  const value = parseNumber(amount, "amount");
  if (typeof cur !== "string" || !/^[A-Za-z]{3}$/.test(cur) || !KNOWN_CURRENCIES.has(cur.toUpperCase())) {
    throw new ApiError(400, "invalid_currency", `currency must be a known ISO 4217 code, got: ${cur}`,
      "Examples: EUR, USD, CHF, JPY, INR.");
  }
  const currencyDisplay = display && ["symbol", "narrowSymbol", "code", "name"].includes(display) ? display : "symbol";
  let fmt;
  try {
    fmt = new Intl.NumberFormat(loc.canonical, { style: "currency", currency: cur.toUpperCase(), currencyDisplay });
  } catch (e) {
    throw new ApiError(400, "invalid_currency", `Unknown currency code '${cur}'.`, "Use an ISO 4217 code like EUR or USD.");
  }
  const parts = fmt.formatToParts(value);
  const firstType = parts.find((p) => p.type !== "literal" && p.type !== "minusSign")?.type;
  return {
    input: { amount: value, currency: cur.toUpperCase(), locale: loc.canonical, display: currencyDisplay },
    formatted: fmt.format(value),
    parts: {
      ...partsSummary(parts),
      symbolPosition: firstType === "currency" ? "prefix" : "suffix",
      fractionDigits: fmt.resolvedOptions().maximumFractionDigits,
    },
    ...meta(loc.resolved),
  };
}

// ---------- number ----------
export function number({ value, locale, style, digits }) {
  const loc = resolveLocale(locale);
  const n = parseNumber(value, "value");
  const opts = {};
  if (style === "percent") opts.style = "percent";
  else if (style && style !== "decimal") {
    throw new ApiError(400, "invalid_style", `style must be 'decimal' or 'percent', got: ${style}`, undefined);
  }
  if (digits !== undefined && digits !== "") {
    const d = Number(digits);
    if (!Number.isInteger(d) || d < 0 || d > 20) {
      throw new ApiError(400, "invalid_digits", `digits must be an integer 0-20, got: ${digits}`, undefined);
    }
    opts.minimumFractionDigits = d;
    opts.maximumFractionDigits = d;
  }
  const fmt = new Intl.NumberFormat(loc.canonical, opts);
  const parts = fmt.formatToParts(n);
  return {
    input: { value: n, locale: loc.canonical, style: opts.style ?? "decimal" },
    formatted: fmt.format(n),
    parts: partsSummary(parts),
    numberingSystem: fmt.resolvedOptions().numberingSystem,
    ...meta(loc.resolved),
  };
}

// ---------- datetime ----------
const STYLES = ["full", "long", "medium", "short"];
export function datetime({ iso, locale, dateStyle, timeStyle, timeZone }) {
  const loc = resolveLocale(locale);
  if (typeof iso !== "string" || Number.isNaN(Date.parse(iso))) {
    throw new ApiError(400, "invalid_iso", `iso must be an ISO 8601 date/time, got: ${iso}`,
      "Examples: 2026-08-19 or 2026-08-19T14:30:00Z.");
  }
  const d = new Date(iso);
  const opts = {};
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  if (dateStyle) {
    if (!STYLES.includes(dateStyle)) throw new ApiError(400, "invalid_dateStyle", `dateStyle must be one of ${STYLES.join("/")}.`, undefined);
    opts.dateStyle = dateStyle;
  } else opts.dateStyle = "medium";
  if (timeStyle) {
    if (!STYLES.includes(timeStyle)) throw new ApiError(400, "invalid_timeStyle", `timeStyle must be one of ${STYLES.join("/")}.`, undefined);
    opts.timeStyle = timeStyle;
  } else if (!dateOnly) opts.timeStyle = "short";
  if (dateOnly) opts.timeZone = "UTC";
  if (timeZone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone });
    } catch {
      throw new ApiError(400, "invalid_timeZone", `Unknown IANA time zone '${timeZone}'.`, "Example: Europe/Berlin.");
    }
    opts.timeZone = timeZone;
  }
  const fmt = new Intl.DateTimeFormat(loc.canonical, opts);
  const ro = fmt.resolvedOptions();
  return {
    input: { iso, locale: loc.canonical, dateStyle: opts.dateStyle ?? null, timeStyle: opts.timeStyle ?? null, timeZone: ro.timeZone },
    formatted: fmt.format(d),
    hourCycle: ro.hourCycle ?? null,
    calendar: ro.calendar,
    ...meta(loc.resolved),
  };
}

// ---------- rules ----------
export function rules({ locale, currency: cur }) {
  const loc = resolveLocale(locale);
  const currencyCode = cur && /^[A-Za-z]{3}$/.test(cur) ? cur.toUpperCase() : "USD";
  const numParts = new Intl.NumberFormat(loc.canonical).formatToParts(1234567.89);
  const curFmt = new Intl.NumberFormat(loc.canonical, { style: "currency", currency: currencyCode });
  const curParts = curFmt.formatToParts(1234.56);
  const firstCurType = curParts.find((p) => p.type !== "literal")?.type;
  // grouping sizes from group positions (e.g. en-IN → [3,2])
  const intDigits = [];
  let run = 0;
  for (const p of numParts) {
    if (p.type === "integer") run += p.value.length;
    if (p.type === "group") { intDigits.push(run); run = 0; }
  }
  intDigits.push(run);
  const groupingSizes = intDigits.slice(1).reverse().concat(intDigits[0] > 0 ? [] : []);
  const dateParts = new Intl.DateTimeFormat(loc.canonical, { dateStyle: "short", timeZone: "UTC" })
    .formatToParts(new Date("2026-12-31T00:00:00Z"))
    .filter((p) => ["year", "month", "day"].includes(p.type))
    .map((p) => p.type);
  let weekInfo = null;
  try {
    const li = new Intl.Locale(loc.resolved);
    weekInfo = li.getWeekInfo ? li.getWeekInfo() : (li.weekInfo ?? null);
  } catch { /* optional */ }
  const hourCycle = new Intl.DateTimeFormat(loc.canonical, { hour: "numeric" }).resolvedOptions().hourCycle;
  return {
    input: { locale: loc.canonical, currency: currencyCode },
    decimalSeparator: numParts.find((p) => p.type === "decimal")?.value ?? null,
    groupSeparator: numParts.find((p) => p.type === "group")?.value ?? null,
    groupingSizes: groupingSizes.length ? groupingSizes : [3],
    currencySymbol: curParts.find((p) => p.type === "currency")?.value ?? null,
    currencyPosition: firstCurType === "currency" ? "prefix" : "suffix",
    currencyFractionDigits: curFmt.resolvedOptions().maximumFractionDigits,
    dateOrder: dateParts.join("-"),
    firstDayOfWeek: weekInfo?.firstDay ?? null,
    weekend: weekInfo?.weekend ?? null,
    numberingSystem: new Intl.NumberFormat(loc.canonical).resolvedOptions().numberingSystem,
    hourCycle: hourCycle ?? null,
    exampleNumber: new Intl.NumberFormat(loc.canonical).format(1234567.89),
    exampleCurrency: curFmt.format(1234.56),
    exampleDate: new Intl.DateTimeFormat(loc.canonical, { dateStyle: "short", timeZone: "UTC" }).format(new Date("2026-12-31T00:00:00Z")),
    ...meta(loc.resolved),
  };
}

// ---------- verify ----------
/** Whitespace/bidi-tolerant normalization: agents shouldn't fail on NBSP vs space. */
function normalize(s) {
  return s
    .normalize("NFC")
    .replace(/[‎‏؜]/g, "") // bidi marks
    .replace(/[    ]/g, " ") // nbsp, narrow nbsp, thin, figure space
    .replace(/\s+/g, " ")
    .trim();
}

export function verify(params) {
  const { formatted, type } = params;
  if (typeof formatted !== "string" || !formatted.trim()) {
    throw new ApiError(400, "missing_formatted", "formatted (the string to verify) is required.",
      "Example: /v1/verify?type=currency&formatted=1.234,56%20%E2%82%AC&amount=1234.56&currency=EUR&locale=de-DE");
  }
  const producers = { currency, number, datetime };
  if (!producers[type]) {
    throw new ApiError(400, "invalid_type", `type must be one of currency/number/datetime, got: ${type}`, undefined);
  }
  const canonical = producers[type](params);
  const expected = canonical.formatted;
  const valid = normalize(formatted) === normalize(expected);
  const differences = [];
  if (!valid) {
    const exp = normalize(expected);
    const got = normalize(formatted);
    if (exp.replace(/[.,'٫٬\s]/g, "") === got.replace(/[.,'٫٬\s]/g, "")) {
      differences.push("digits match but separators/spacing differ (wrong decimal or group separator for this locale)");
    }
    if (type === "currency") {
      const sym = canonical.parts.symbol;
      if (sym && !got.includes(normalize(sym))) differences.push(`expected currency symbol '${sym}' not found`);
      else if (sym) {
        const expPrefix = exp.startsWith(normalize(sym));
        const gotPrefix = got.startsWith(normalize(sym));
        if (expPrefix !== gotPrefix) differences.push(`currency symbol on the wrong side (locale uses ${canonical.parts.symbolPosition})`);
      }
    }
    if (!differences.length) differences.push("formatted string does not match the canonical CLDR output");
  }
  return {
    input: { type, formatted, locale: canonical.input.locale },
    valid,
    expected,
    differences,
    ...meta(canonical.resolvedLocale),
  };
}

// ---------- locales (free) ----------
export function locales() {
  const all = Intl.NumberFormat.supportedLocalesOf(
    // Probe a broad set: ICU supports far more; supportedLocalesOf needs candidates,
    // so enumerate via Intl's own available locales API when present.
    Intl.supportedValuesOf ? [] : [],
  );
  // Node 22 exposes the full list via Intl.DisplayNames probing; simplest reliable source:
  const list = Intl.NumberFormat.supportedLocalesOf(PROBE_LOCALES);
  return { count: list.length, locales: list, source: SOURCE, verifiedAt: VERIFIED_AT };
}

// A broad, curated probe list (major locales incl. regional variants).
const PROBE_LOCALES = (() => {
  const langs = ["af","am","ar","az","be","bg","bn","bs","ca","cs","cy","da","de","el","en","es","et","eu","fa","fi","fil","fr","ga","gl","gu","he","hi","hr","hu","hy","id","is","it","ja","ka","kk","km","kn","ko","ky","lo","lt","lv","mk","ml","mn","mr","ms","my","ne","nl","no","pa","pl","ps","pt","ro","ru","si","sk","sl","sq","sr","sv","sw","ta","te","th","tr","uk","ur","uz","vi","zh","zu"];
  const regions = { de: ["DE","AT","CH","LI","LU"], en: ["US","GB","IN","AU","CA","NZ","IE","SG","ZA"], es: ["ES","MX","AR","CO","CL","US"], fr: ["FR","BE","CA","CH","LU"], pt: ["PT","BR"], zh: ["CN","TW","HK","SG"], ar: ["EG","SA","AE","MA","IQ"], nl: ["NL","BE"], it: ["IT","CH"], ru: ["RU","BY","KZ"], sv: ["SE","FI"] };
  const out = [];
  for (const l of langs) {
    out.push(l);
    for (const r of regions[l] ?? []) out.push(`${l}-${r}`);
  }
  return out;
})();
