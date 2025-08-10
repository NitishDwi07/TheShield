import type { UILang } from "./language"

// Stronger, evidence-based multilingual scam intent heuristic.
//
// Key goals:
// - High weight for sensitive asks: OTP, bank account/IBAN/routing, card number/CVV/expiry, trading/broker credentials.
// - Evidence snippets: include the matched text so users can see why it was flagged.
// - Stable 0..100 score with quick saturation for sensitive info.
// - Language support: EN primary, with ES/FR basics, DE minimal. Fallback to EN.
//
// You can still combine this with the server classifier for even better accuracy [^1].

export type Category =
  | "otp"
  | "bank_account"
  | "card_number"
  | "card_cvv"
  | "card_expiry"
  | "routing"
  | "identity"
  | "payment_alt"
  | "authority"
  | "urgency"
  | "secrecy"
  | "remote"
  | "threat"
  | "stock_broker"

export type MatchHit = {
  category: Category
  weight: number
  phrase: string
  index: number
  snippet: string
}

export type AnalysisResult = {
  score: number // 0..100
  reasons: string[]
  hits: MatchHit[]
}

type Rule = {
  category: Category
  // Either plain regex or a custom detect function.
  re?: RegExp
  weight: number
  reason: string
  // If provided, allows custom extract/validation (e.g., Luhn for cards).
  detect?: (text: string) => MatchHit[]
}

function normalize(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function snippetAround(text: string, index: number, length: number) {
  const start = Math.max(0, index - 30)
  const end = Math.min(text.length, index + length + 30)
  return text.slice(start, end).trim()
}

// Luhn check for card numbers
function luhnValid(num: string) {
  const digits = num.replace(/\D/g, "")
  if (digits.length < 12 || digits.length > 19) return false
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number.parseInt(digits[i]!, 10)
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

function cardNumberDetector(category: Category, weight: number, reason: string): Rule {
  return {
    category,
    weight,
    reason,
    detect: (text: string) => {
      const hits: MatchHit[] = []
      // Look for context words to reduce false positives
      const ctx = /(?:card (?:number|no\.?)|debit|credit|visa|mastercard|amex)[^.\n]{0,40}?((?:\d[ -]?){12,19})/gi
      let m: RegExpExecArray | null
      while ((m = ctx.exec(text))) {
        const raw = m[1] || ""
        const digits = raw.replace(/\D/g, "")
        if (luhnValid(digits)) {
          hits.push({
            category,
            weight,
            phrase: raw.trim(),
            index: m.index,
            snippet: snippetAround(text, m.index, m[0]?.length || raw.length),
          })
        }
      }
      return hits
    },
  }
}

function genericNumberWithContextDetector(
  category: Category,
  weight: number,
  reason: string,
  contexts: RegExp,
  numberRe: RegExp,
): Rule {
  return {
    category,
    weight,
    reason,
    detect: (text: string) => {
      const hits: MatchHit[] = []
      // Look for context, then a nearby number/token
      const re = new RegExp(
        `${contexts.source}[^\\n]{0,40}?(${numberRe.source})`,
        contexts.flags.includes("i") ? "gi" : "g",
      )
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        const token = m[1] || ""
        hits.push({
          category,
          weight,
          phrase: token,
          index: m.index,
          snippet: snippetAround(text, m.index, m[0]?.length || token.length),
        })
      }
      return hits
    },
  }
}

function makeRulesEN(): Rule[] {
  // Context patterns
  const otpCtx = /\b(otp|one[-\s]?time(?:\s*(?:password|passcode|code))|verification code|6[-\s]?digit code)\b/i
  const bankCtx = /\b(account (?:number|no\.?)|acct\.?|iban|ifsc|sort code|routing number|swift|bic|bank details?)\b/i
  const routingCtx = /\b(iban|ifsc|sort code|routing number|swift|bic)\b/i
  const cvvCtx = /\b(cvv|cvc|security code)\b/i
  const expiryCtx = /\b(expiry|expiration|valid (?:thru|through))\b/i
  const stockCtx =
    /\b(broker|demat|dp id|portfolio|holdings|trading (?:password|pin)|share(?:s)?|sell (?:your )?shares|insider)\b/i

  // Number patterns
  const otpNum = /\b\d{4,8}\b/
  const acctNum = /\b\d{6,18}\b/
  const routingToken = /\b[A-Z0-9]{6,34}\b/
  const cvvNum = /\b\d{3,4}\b/
  const expiryToken = /\b(0[1-9]|1[0-2])\s*[/-]\s*(\d{2,4})\b/

  const existingRules = [
    genericNumberWithContextDetector("otp", 3.0, "Requested your one-time passcode (OTP)", otpCtx, otpNum),
    genericNumberWithContextDetector(
      "bank_account",
      2.6,
      "Asked for bank account/IBAN/routing details",
      bankCtx,
      acctNum,
    ),
    cardNumberDetector("card_number", 3.0, "Asked for your full card number"),
    genericNumberWithContextDetector("card_cvv", 3.0, "Asked for your CVV/security code", cvvCtx, cvvNum),
    genericNumberWithContextDetector("card_expiry", 1.6, "Asked for your card expiry date", expiryCtx, expiryToken),
    genericNumberWithContextDetector(
      "routing",
      2.0,
      "Asked for IBAN/SWIFT/IFSC/routing code",
      routingCtx,
      routingToken,
    ),

    // Keyword-only patterns (no numbers required)
    {
      category: "payment_alt",
      re: /\b(gift\s*card|google play|apple (?:gift )?card|steam card|bitcoin|crypto|usdt|wire transfer|western union|moneygram|prepaid)\b/i,
      weight: 1.8,
      reason: "Asks for payment via gift cards/crypto/wire",
    },
    {
      category: "authority",
      re: /\b(bank (?:security|fraud) (?:team|department)|irs|social security|police|fbi|customs)\b/i,
      weight: 1.2,
      reason: "Claims to be an authority to pressure you",
    },
    {
      category: "urgency",
      re: /\b(urgent|immediately|right now|do not hang up|stay on the line|act now)\b/i,
      weight: 0.9,
      reason: "Uses urgency to force quick action",
    },
    {
      category: "secrecy",
      re: /\b(keep (?:this|it) (?:secret|between us)|do not tell|don't tell anyone)\b/i,
      weight: 1.0,
      reason: "Tells you to keep it secret",
    },
    {
      category: "remote",
      re: /\b(anydesk|teamviewer|remote access|install (?:anydesk|teamviewer))\b/i,
      weight: 1.6,
      reason: "Requests remote access tools",
    },
    {
      category: "threat",
      re: /\b(legal action|lawsuit|arrest|account (?:compromised|suspended|locked))\b/i,
      weight: 1.3,
      reason: "Threatens legal/account consequences",
    },
    {
      category: "identity",
      re: /\b(verify|confirm).{0,12}(your )?identity\b/i,
      weight: 1.2,
      reason: "Asks to verify your identity",
    },
    {
      category: "stock_broker",
      re: /\b(broker|demat|dp id|portfolio|holdings|trading (?:password|pin)|sell (?:your )?shares|insider)\b/i,
      weight: 1.6,
      reason: "Asks for broker/Demat credentials or pressures trades",
    },
  ]

  const keywordOnlyEN: Rule[] = [
    {
      category: "otp",
      re: /\b(otp|one[-\s]?time(?:\s*(?:password|passcode|code))|verification code)\b/i,
      weight: 2.0,
      reason: "Asked for an OTP/verification code",
    },
    {
      category: "bank_account",
      re: /\b(bank details?|account (?:number|no\.?)|iban|swift|bic|routing number|sort code)\b/i,
      weight: 2.2,
      reason: "Asked for bank details/account numbers",
    },
    {
      category: "routing",
      re: /\b(iban|swift|bic|ifsc|routing number|sort code)\b/i,
      weight: 1.6,
      reason: "Asked for IBAN/SWIFT/IFSC/routing",
    },
    {
      category: "stock_broker",
      re: /\b((?:trading|broker|demat).{0,16}(?:password|pin|passcode))\b/i,
      weight: 1.8,
      reason: "Asked for trading/broker password or PIN",
    },
    {
      category: "identity",
      re: /\b(netbanking|bank|trading).{0,12}(password|pin)\b/i,
      weight: 1.4,
      reason: "Asked for banking/trading password or PIN",
    },
  ]

  // At the end of makeRulesEN() return value, spread keywordOnlyEN:
  return [
    ...existingRules, // keep your current list
    ...keywordOnlyEN,
  ]
}

function makeRulesES(): Rule[] {
  const otpCtx =
    /\b(otp|codigo(?: de)? verificacion|c[oó]digo de verificación|clave de un solo uso|6[-\s]?d[ií]gitos)\b/i
  const bankCtx = /\b(n[uú]mero de cuenta|iban|swift|bic|c[oó]digo (?:de )?bancario|datos bancarios)\b/i
  const cvvCtx = /\b(cvv|cvc|c[oó]digo de seguridad)\b/i
  const expiryCtx = /\b(vigencia|vencimiento|valido hasta)\b/i
  const otpNum = /\b\d{4,8}\b/
  const acctNum = /\b\d{6,18}\b/
  const cvvNum = /\b\d{3,4}\b/
  const expiryToken = /\b(0[1-9]|1[0-2])\s*[/-]\s*(\d{2,4})\b/

  const existingRulesES = [
    genericNumberWithContextDetector("otp", 3.0, "Le solicitaron su código OTP", otpCtx, otpNum),
    genericNumberWithContextDetector("bank_account", 2.5, "Pidieron su número de cuenta/IBAN/SWIFT", bankCtx, acctNum),
    cardNumberDetector("card_number", 3.0, "Pidieron el número completo de su tarjeta"),
    genericNumberWithContextDetector("card_cvv", 3.0, "Pidieron el CVV/código de seguridad", cvvCtx, cvvNum),
    genericNumberWithContextDetector(
      "card_expiry",
      1.5,
      "Pidieron la fecha de vencimiento de la tarjeta",
      expiryCtx,
      expiryToken,
    ),
    {
      category: "payment_alt",
      re: /\b(tarjeta(s)? de regalo|bitcoin|cripto|transferencia|western union|moneygram|prepago)\b/i,
      weight: 1.7,
      reason: "Piden pago con tarjetas de regalo/cripto/transferencia",
    },
  ]

  const keywordOnlyES: Rule[] = [
    {
      category: "otp",
      re: /\b(otp|c[oó]digo (?:de )?verificaci[oó]n|clave de un solo uso)\b/i,
      weight: 2.0,
      reason: "Le solicitaron código OTP/verificación",
    },
    {
      category: "bank_account",
      re: /\b(datos bancarios|n[uú]mero de cuenta|iban|swift|bic|clave interbancaria)\b/i,
      weight: 2.2,
      reason: "Pidieron datos bancarios/número de cuenta",
    },
    {
      category: "stock_broker",
      re: /\b((?:trading|br[oó]ker).{0,16}(?:contrase[ñn]a|pin|clave))\b/i,
      weight: 1.8,
      reason: "Pidieron clave/PIN de trading o bróker",
    },
  ]

  // Spread into returned array:
  return [...existingRulesES, ...keywordOnlyES]
}

function makeRulesFR(): Rule[] {
  const otpCtx = /\b(otp|code (?:de )?v[ée]rification|mot de passe (?:unique|à usage unique)|6[-\s]?chiffres)\b/i
  const bankCtx = /\b(iban|swift|bic|num[ée]ro de compte|coordonn[ée]es bancaires)\b/i
  const cvvCtx = /\b(cvv|cvc|cryptogramme(?: visuel)?)\b/i
  const expiryCtx = /\b(date d'expiration|valable jusqu'?[au])\b/i
  const otpNum = /\b\d{4,8}\b/
  const acctNum = /\b\d{6,18}\b/
  const cvvNum = /\b\d{3,4}\b/
  const expiryToken = /\b(0[1-9]|1[0-2])\s*[/-]\s*(\d{2,4})\b/

  const existingRulesFR = [
    genericNumberWithContextDetector("otp", 3.0, "Code OTP demandé", otpCtx, otpNum),
    genericNumberWithContextDetector("bank_account", 2.5, "Demande d'IBAN/SWIFT/numéro de compte", bankCtx, acctNum),
    cardNumberDetector("card_number", 3.0, "Demande du numéro complet de carte"),
    genericNumberWithContextDetector("card_cvv", 3.0, "Demande du CVV/cryptogramme", cvvCtx, cvvNum),
    genericNumberWithContextDetector(
      "card_expiry",
      1.5,
      "Demande de la date d'expiration de la carte",
      expiryCtx,
      expiryToken,
    ),
    {
      category: "payment_alt",
      re: /\b(carte(s)? cadeau|bitcoin|crypto|virement|western union|moneygram|pr[eé]pay[eé])\b/i,
      weight: 1.7,
      reason: "Demande de paiement via cartes cadeaux/crypto/virement",
    },
  ]

  const keywordOnlyFR: Rule[] = [
    {
      category: "otp",
      re: /\b(otp|code (?:de )?v[ée]rification|mot de passe (?:unique|à usage unique))\b/i,
      weight: 2.0,
      reason: "Code OTP / vérification demandé",
    },
    {
      category: "bank_account",
      re: /\b(coordonn[ée]es bancaires|num[ée]ro de compte|iban|swift|bic)\b/i,
      weight: 2.2,
      reason: "Demande de coordonnées bancaires/numéro de compte",
    },
    {
      category: "stock_broker",
      re: /\b((?:trading|broker|courtier).{0,16}(?:mot de passe|code|pin))\b/i,
      weight: 1.8,
      reason: "Demande de mot de passe/PI N de trading/broker",
    },
  ]

  // Spread into returned array:
  return [...existingRulesFR, ...keywordOnlyFR]
}

function makeRulesDE(): Rule[] {
  const existingRulesDE = [
    {
      category: "payment_alt",
      re: /\b(Geschenkkarte|bitcoin|krypto|Überweisung|western union|moneygram|prepaid)\b/i,
      weight: 1.6,
      reason: "Zahlung per Geschenkkarten/Krypto/Überweisung verlangt",
    },
    {
      category: "remote",
      re: /\b(Fernzugriff|anydesk|teamviewer)\b/i,
      weight: 1.6,
      reason: "Fernzugriffs-Tools angefordert",
    },
  ]

  const keywordOnlyDE: Rule[] = [
    {
      category: "otp",
      re: /\b(otp|einmal(?:code|passwort)|verifizierungscode)\b/i,
      weight: 2.0,
      reason: "Einmalcode/Verifizierungscode angefordert",
    },
    {
      category: "bank_account",
      re: /\b(iban|swift|bic|kontonummer|bankdaten)\b/i,
      weight: 2.0,
      reason: "Bankdaten/Kontonummer angefordert",
    },
  ]

  // Spread into returned array:
  return [...existingRulesDE, ...keywordOnlyDE]
}

function getRules(lang: UILang): Rule[] {
  switch (lang) {
    case "es":
      return makeRulesES().concat(makeRulesEN()) // reuse EN safety nets
    case "fr":
      return makeRulesFR().concat(makeRulesEN())
    case "de":
      return makeRulesDE().concat(makeRulesEN())
    default:
      return makeRulesEN()
  }
}

function saturatingScore(sumWeights: number) {
  // Sensitive info should escalate quickly: smaller denominator => faster saturation.
  const s = 1 - Math.exp(-sumWeights / 2.5)
  return Math.round(100 * Math.max(0, Math.min(1, s)))
}

export function analyzeScamText(textRaw: string, lang: UILang): AnalysisResult {
  const text = normalize(textRaw)
  const rules = getRules(lang)
  const hits: MatchHit[] = []

  for (const rule of rules) {
    if (rule.detect) {
      hits.push(...rule.detect(text))
    } else if (rule.re) {
      let m: RegExpExecArray | null
      const re = new RegExp(rule.re.source, rule.re.flags.includes("i") ? "gi" : "g")
      while ((m = re.exec(text))) {
        hits.push({
          category: rule.category,
          weight: rule.weight,
          phrase: m[0] || "",
          index: m.index,
          snippet: snippetAround(text, m.index, (m[0] || "").length),
        })
      }
    }
  }

  // Aggregate weights, but limit repeats per category to reduce over-inflation
  const perCategoryCount = new Map<Category, number>()
  let total = 0
  for (const h of hits) {
    const c = perCategoryCount.get(h.category) || 0
    const attenuated = h.weight * (c === 0 ? 1 : c === 1 ? 0.7 : 0.5)
    total += attenuated
    perCategoryCount.set(h.category, c + 1)
  }

  const score = saturatingScore(total)

  // Build top reasons, prioritize sensitive categories
  const priority: Category[] = [
    "otp",
    "card_number",
    "card_cvv",
    "card_expiry",
    "bank_account",
    "routing",
    "stock_broker",
    "payment_alt",
    "remote",
    "authority",
    "secrecy",
    "threat",
    "urgency",
    "identity",
  ]
  const byCategory = new Map<Category, MatchHit[]>()
  for (const h of hits) {
    if (!byCategory.has(h.category)) byCategory.set(h.category, [])
    byCategory.get(h.category)!.push(h)
  }

  const reasons: string[] = []
  for (const cat of priority) {
    if (byCategory.has(cat)) {
      const labels = {
        otp: "Requested your one-time code (OTP)",
        bank_account: "Asked for bank account/IBAN/routing details",
        card_number: "Asked for your full card number",
        card_cvv: "Asked for your CVV/security code",
        card_expiry: "Asked for your card expiry date",
        routing: "Asked for IBAN/SWIFT/IFSC/routing code",
        payment_alt: "Requested payment via gift cards/crypto/wire transfer",
        authority: "Claimed authority to pressure you",
        urgency: "Used urgency to force quick action",
        secrecy: "Told you to keep it secret",
        remote: "Asked you to install remote access tools",
        threat: "Threatened legal/account consequences",
        stock_broker: "Asked for broker/Demat credentials or pressured trades",
        identity: "Asked to verify your identity",
      } as Record<Category, string>
      reasons.push(labels[cat])
    }
    if (reasons.length >= 5) break
  }

  return { score, reasons, hits }
}

// Legacy convenience if you still call this:
export function keywordHeuristicScore(text: string, lang: UILang): number {
  return analyzeScamText(text, lang).score
}
