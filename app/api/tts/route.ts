import { NextResponse } from "next/server"

// Health probe: 200 if ELEVENLABS_API_KEY is set, else 503
export async function OPTIONS() {
  const configured = Boolean(process.env.ELEVENLABS_API_KEY)
  return new NextResponse(null, { status: configured ? 200 : 503 })
}

/**
 * POST /api/tts
 * body: { text: string, lang?: "en"|"es"|"fr"|"de" }
 * returns: audio/mpeg buffer of spoken text using ElevenLabs
 */
export async function POST(req: Request) {
  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json({ ok: false, error: "ELEVENLABS_API_KEY not set" }, { status: 501 })
  }
  try {
    const { text, lang } = await req.json()

    if (!text || typeof text !== "string") {
      return NextResponse.json({ ok: false, error: "Missing text" }, { status: 400 })
    }

    // Default voices; you can swap to your preferred IDs later.
    // "Rachel" is a common default ID in ElevenLabs docs.
    const defaultVoiceId = "21m00Tcm4TlvDq8ikWAM" // Rachel
    const voiceId = defaultVoiceId

    const payload = {
      model_id: "eleven_multilingual_v2",
      text,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.85,
        style: 0.15,
        use_speaker_boost: true,
      },
    }

    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY as string,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify(payload),
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "Unknown error")
      return NextResponse.json({ ok: false, error: errText }, { status: 500 })
    }

    const audioBuf = await resp.arrayBuffer()
    return new NextResponse(audioBuf, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 })
  }
}
