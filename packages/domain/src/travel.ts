/**
 * Travel mode (owner, 2026-11-25: "works wherever you are", something Muse, US and UK only, can't
 * do). What a visitor needs at hand in each country: its money, emergency numbers and language.
 *
 * Only countries whose numbers are well established are listed; anywhere else the app says to
 * check locally rather than guess. Numbers can differ by city or network, and the app says so.
 */
export interface EmergencyNumber {
  /** "Police", "Ambulance and fire", or "Emergency" for one number for everything. */
  for: string;
  number: string;
}
export interface CountryFacts {
  name: string;
  currency: { code: string; name: string };
  emergency: EmergencyNumber[];
  /** The language to offer phrases in, and the others people speak there. */
  language: string;
  alsoSpoken?: string[];
}

const all = (number: string): EmergencyNumber[] => [{ for: "Emergency", number }];
const euro = { code: "EUR", name: "euro" };

export const COUNTRIES: Record<string, CountryFacts> = {
  US: {
    name: "the United States",
    currency: { code: "USD", name: "US dollar" },
    emergency: all("911"),
    language: "English",
  },
  CA: {
    name: "Canada",
    currency: { code: "CAD", name: "Canadian dollar" },
    emergency: all("911"),
    language: "English",
    alsoSpoken: ["French"],
  },
  MX: {
    name: "Mexico",
    currency: { code: "MXN", name: "Mexican peso" },
    emergency: all("911"),
    language: "Spanish",
  },
  GB: {
    name: "the United Kingdom",
    currency: { code: "GBP", name: "pound sterling" },
    emergency: all("999 (or 112)"),
    language: "English",
  },
  IE: {
    name: "Ireland",
    currency: euro,
    emergency: all("112 (or 999)"),
    language: "English",
    alsoSpoken: ["Irish"],
  },
  FR: { name: "France", currency: euro, emergency: all("112"), language: "French" },
  DE: {
    name: "Germany",
    currency: euro,
    emergency: [
      { for: "Ambulance and fire", number: "112" },
      { for: "Police", number: "110" },
    ],
    language: "German",
  },
  ES: { name: "Spain", currency: euro, emergency: all("112"), language: "Spanish" },
  IT: { name: "Italy", currency: euro, emergency: all("112"), language: "Italian" },
  PT: { name: "Portugal", currency: euro, emergency: all("112"), language: "Portuguese" },
  NL: { name: "the Netherlands", currency: euro, emergency: all("112"), language: "Dutch" },
  BE: {
    name: "Belgium",
    currency: euro,
    emergency: all("112"),
    language: "Dutch",
    alsoSpoken: ["French", "German"],
  },
  AT: { name: "Austria", currency: euro, emergency: all("112"), language: "German" },
  CH: {
    name: "Switzerland",
    currency: { code: "CHF", name: "Swiss franc" },
    emergency: [
      { for: "Emergency", number: "112" },
      { for: "Ambulance", number: "144" },
      { for: "Police", number: "117" },
      { for: "Fire", number: "118" },
    ],
    language: "German",
    alsoSpoken: ["French", "Italian"],
  },
  GR: { name: "Greece", currency: euro, emergency: all("112"), language: "Greek" },
  SE: {
    name: "Sweden",
    currency: { code: "SEK", name: "Swedish krona" },
    emergency: all("112"),
    language: "Swedish",
  },
  DK: {
    name: "Denmark",
    currency: { code: "DKK", name: "Danish krone" },
    emergency: all("112"),
    language: "Danish",
  },
  FI: {
    name: "Finland",
    currency: euro,
    emergency: all("112"),
    language: "Finnish",
    alsoSpoken: ["Swedish"],
  },
  PL: {
    name: "Poland",
    currency: { code: "PLN", name: "Polish złoty" },
    emergency: all("112"),
    language: "Polish",
  },
  CZ: {
    name: "Czechia",
    currency: { code: "CZK", name: "Czech koruna" },
    emergency: all("112"),
    language: "Czech",
  },
  HU: {
    name: "Hungary",
    currency: { code: "HUF", name: "Hungarian forint" },
    emergency: all("112"),
    language: "Hungarian",
  },
  HR: { name: "Croatia", currency: euro, emergency: all("112"), language: "Croatian" },
  IS: {
    name: "Iceland",
    currency: { code: "ISK", name: "Icelandic króna" },
    emergency: all("112"),
    language: "Icelandic",
  },
  TR: {
    name: "Türkiye",
    currency: { code: "TRY", name: "Turkish lira" },
    emergency: all("112"),
    language: "Turkish",
  },
  JP: {
    name: "Japan",
    currency: { code: "JPY", name: "Japanese yen" },
    emergency: [
      { for: "Police", number: "110" },
      { for: "Ambulance and fire", number: "119" },
    ],
    language: "Japanese",
  },
  KR: {
    name: "South Korea",
    currency: { code: "KRW", name: "South Korean won" },
    emergency: [
      { for: "Police", number: "112" },
      { for: "Ambulance and fire", number: "119" },
    ],
    language: "Korean",
  },
  CN: {
    name: "China",
    currency: { code: "CNY", name: "Chinese yuan" },
    emergency: [
      { for: "Police", number: "110" },
      { for: "Ambulance", number: "120" },
      { for: "Fire", number: "119" },
    ],
    language: "Mandarin Chinese",
  },
  HK: {
    name: "Hong Kong",
    currency: { code: "HKD", name: "Hong Kong dollar" },
    emergency: all("999"),
    language: "Cantonese",
    alsoSpoken: ["English"],
  },
  TW: {
    name: "Taiwan",
    currency: { code: "TWD", name: "New Taiwan dollar" },
    emergency: [
      { for: "Police", number: "110" },
      { for: "Ambulance and fire", number: "119" },
    ],
    language: "Mandarin Chinese",
  },
  SG: {
    name: "Singapore",
    currency: { code: "SGD", name: "Singapore dollar" },
    emergency: [
      { for: "Police", number: "999" },
      { for: "Ambulance and fire", number: "995" },
    ],
    language: "English",
    alsoSpoken: ["Mandarin", "Malay", "Tamil"],
  },
  MY: {
    name: "Malaysia",
    currency: { code: "MYR", name: "Malaysian ringgit" },
    emergency: all("999 (or 112 from a mobile)"),
    language: "Malay",
    alsoSpoken: ["English"],
  },
  TH: {
    name: "Thailand",
    currency: { code: "THB", name: "Thai baht" },
    emergency: [
      { for: "Police", number: "191" },
      { for: "Ambulance", number: "1669" },
      { for: "Tourist police", number: "1155" },
    ],
    language: "Thai",
  },
  VN: {
    name: "Vietnam",
    currency: { code: "VND", name: "Vietnamese đồng" },
    emergency: [
      { for: "Police", number: "113" },
      { for: "Fire", number: "114" },
      { for: "Ambulance", number: "115" },
    ],
    language: "Vietnamese",
  },
  KH: {
    name: "Cambodia",
    currency: { code: "KHR", name: "Cambodian riel (US dollars are widely used)" },
    emergency: [
      { for: "Police", number: "117" },
      { for: "Fire", number: "118" },
      { for: "Ambulance", number: "119" },
    ],
    language: "Khmer",
  },
  PH: {
    name: "the Philippines",
    currency: { code: "PHP", name: "Philippine peso" },
    emergency: all("911"),
    language: "Filipino",
    alsoSpoken: ["English"],
  },
  IN: {
    name: "India",
    currency: { code: "INR", name: "Indian rupee" },
    emergency: all("112"),
    language: "Hindi",
    alsoSpoken: ["English"],
  },
  AE: {
    name: "the United Arab Emirates",
    currency: { code: "AED", name: "UAE dirham" },
    emergency: [
      { for: "Police", number: "999" },
      { for: "Ambulance", number: "998" },
      { for: "Fire", number: "997" },
    ],
    language: "Arabic",
    alsoSpoken: ["English"],
  },
  IL: {
    name: "Israel",
    currency: { code: "ILS", name: "Israeli new shekel" },
    emergency: [
      { for: "Police", number: "100" },
      { for: "Ambulance", number: "101" },
      { for: "Fire", number: "102" },
    ],
    language: "Hebrew",
    alsoSpoken: ["Arabic", "English"],
  },
  AU: {
    name: "Australia",
    currency: { code: "AUD", name: "Australian dollar" },
    emergency: all("000 (or 112 from a mobile)"),
    language: "English",
  },
  NZ: {
    name: "New Zealand",
    currency: { code: "NZD", name: "New Zealand dollar" },
    emergency: all("111"),
    language: "English",
    alsoSpoken: ["Māori"],
  },
  BR: {
    name: "Brazil",
    currency: { code: "BRL", name: "Brazilian real" },
    emergency: [
      { for: "Police", number: "190" },
      { for: "Ambulance", number: "192" },
      { for: "Fire", number: "193" },
    ],
    language: "Portuguese",
  },
  CL: {
    name: "Chile",
    currency: { code: "CLP", name: "Chilean peso" },
    emergency: [
      { for: "Ambulance", number: "131" },
      { for: "Fire", number: "132" },
      { for: "Police", number: "133" },
    ],
    language: "Spanish",
  },
  CO: {
    name: "Colombia",
    currency: { code: "COP", name: "Colombian peso" },
    emergency: all("123"),
    language: "Spanish",
  },
  ZA: {
    name: "South Africa",
    currency: { code: "ZAR", name: "South African rand" },
    emergency: [
      { for: "Police", number: "10111" },
      { for: "Ambulance", number: "10177" },
      { for: "From a mobile", number: "112" },
    ],
    language: "English",
    alsoSpoken: ["Zulu", "Xhosa", "Afrikaans"],
  },
};

/**
 * Help from home while abroad: where to find their embassy, and the line for citizens in trouble.
 * Only countries whose services are well known; others get no line rather than a guess.
 */
export const EMBASSY_HELP: Record<
  string,
  { finder: string; label: string; line?: string; lineName?: string }
> = {
  US: {
    finder: "https://www.usembassy.gov/",
    label: "US embassies and consulates",
    line: "+1 202-501-4444 (US citizens’ emergency line, from abroad)",
    lineName: "US citizens’ line",
  },
  GB: {
    finder: "https://www.gov.uk/world/embassies",
    label: "British embassies and consulates",
    line: "+44 20 7008 5000 (FCDO, for British nationals, any time)",
    lineName: "British nationals’ line",
  },
  CA: {
    finder: "https://travel.gc.ca/assistance/embassies-consulates",
    label: "Canadian embassies and consulates",
  },
  AU: {
    finder: "https://www.smartraveller.gov.au/",
    label: "Smartraveller (Australian help abroad)",
  },
};

export const countryFacts = (code?: string) => (code ? COUNTRIES[code.toUpperCase()] : undefined);

/** "Police 999 · Ambulance and fire 995", the same words on the card, by voice and in the chat. */
export const emergencyWords = (facts?: CountryFacts) =>
  facts?.emergency.map((e) => `${e.for} ${e.number}`).join(" · ") ?? "";
