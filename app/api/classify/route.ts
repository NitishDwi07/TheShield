import { NextResponse } from "next/server"
import { generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

// Health probe: 200 if configured, 503 if not
export async function OPTIONS() {
  const configured = Boolean(process.env.OPENAI_API_KEY || (process.env as any).apikey)
  return new NextResponse(null, { status: configured ? 200 : 503 })
}

export async function POST(req: Request) {
  try {
    const { text, lang } = await req.json()
    const OPENAI_KEY = process.env.OPENAI_API_KEY || (process.env as any).apikey
    if (!OPENAI_KEY) {
      return NextResponse.json(
        { ok: false, error: "OPENAI_API_KEY not set (APIKEY also supported); server classifier disabled." },
        { status: 501 },
      )
    }

    const system = [
      "You detect scam intent in call transcripts.",
      "Return a JSON object with fields: scam_score (0..1), top_reasons (array of short strings).",
      "Be language-aware: English, Spanish, French, German.",
      "Indicators: urgency, identity verification, gift cards/crypto/wire, code-sharing, do not hang up, remote-access apps, banking/card details, trading/broker credentials.",
      "If uncertain, return a low score.",
    ].join(" ")

    const user = `Lang: ${lang}\nText: ${text}\nRespond ONLY with JSON like {"scam_score":0.42,"top_reasons":["reason1","reason2"]}`

    // Explicitly pass the API key so it works with either env name
    const oai = createOpenAI({ apiKey: OPENAI_KEY })
    const { text: out } = await generateText({
      model: oai("gpt-4o"),
      system,
      prompt: user,
    })

    const match = out.match(/\{[\s\S]*\}/)
    let scam_score = 0
    let top_reasons: string[] = []
    if (match) {
      try {
        const parsed = JSON.parse(match[0]!)
        scam_score = Math.min(1, Math.max(0, Number(parsed.scam_score) || 0))
        if (Array.isArray(parsed.top_reasons)) {
          top_reasons = parsed.top_reasons.slice(0, 4).map((r) => String(r))
        }
      } catch {}
    }
    return NextResponse.json({ ok: true, scam_score, top_reasons, model: "openai:gpt-4o" })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 })
  }
}
