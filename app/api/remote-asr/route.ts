import { NextResponse } from "next/server"

// Health probe: 200 if configured, 503 if not
export async function OPTIONS() {
  const configured = Boolean(process.env.OPENAI_API_KEY)
  return new NextResponse(null, { status: configured ? 200 : 503 })
}

/**
 * POST /api/remote-asr?lang=en
 * Body: binary audio (audio/webm;codecs=opus) chunk from MediaRecorder
 * Returns: { ok: true, text: string }
 */
export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ ok: false, error: "OPENAI_API_KEY not set; remote ASR disabled." }, { status: 501 })
  }
  try {
    const { searchParams } = new URL(req.url)
    const lang = searchParams.get("lang") || undefined

    // Read raw audio blob from request body
    const ab = await req.arrayBuffer()
    if (!ab || ab.byteLength === 0) {
      return NextResponse.json({ ok: false, error: "No audio received" }, { status: 400 })
    }

    // Prepare multipart form for OpenAI Transcriptions
    const form = new FormData()
    // Use modern model with low latency for speech-to-text
    form.set("model", "gpt-4o-mini-transcribe")
    if (lang) form.set("language", lang)
    // Wrap the incoming data as a File so OpenAI receives a named file
    const file = new File([ab], "remote-audio.webm", { type: "audio/webm" })
    form.set("file", file)

    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form,
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "Unknown ASR error")
      return NextResponse.json({ ok: false, error: errText }, { status: 500 })
    }

    const data = await resp.json()
    // Response shape: { text: "..." }
    const text: string = data?.text || ""

    return NextResponse.json({ ok: true, text })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 })
  }
}
