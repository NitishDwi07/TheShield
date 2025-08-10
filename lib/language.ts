import { franc } from "franc-min"

export type UILang = "en" | "es" | "fr" | "de" | "hi"

export const supportedLangs: UILang[] = ["en", "es", "fr", "de", "hi"]

const isoToUI: Record<string, UILang> = {
  eng: "en",
  spa: "es",
  fra: "fr",
  fre: "fr",
  deu: "de",
  ger: "de",
  hin: "hi",
}

export function detectLanguageCode(text: string): UILang {
  try {
    const code = franc(text || "", { minLength: 8 })
    return isoToUI[code] || "en"
  } catch {
    return "en"
  }
}
