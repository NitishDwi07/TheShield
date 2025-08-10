"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  ShieldAlert,
  Mic,
  MonitorSmartphone,
  Activity,
  Languages,
  Bell,
  Volume2,
  Download,
  PhoneOff,
  MicOff,
  MessageCircleWarning,
  AudioWaveformIcon as Waveform,
} from "lucide-react"
import { computeCloneLikelihood } from "@/lib/dsp"
import { detectLanguageCode, supportedLangs, type UILang } from "@/lib/language"
import { analyzeScamText, type AnalysisResult } from "@/lib/scam-rules"
import { buildReportMarkdown, downloadText } from "@/lib/report"

type Mode = "mic" | "system" | "both"

type ClassifyResponse = {
  ok: boolean
  scam_score?: number // 0..1
  top_reasons?: string[]
  model?: string
  error?: string
}

type Props = {
  remoteStream?: MediaStream | null
  onHighRisk?: (risk: number, reasons: string[]) => void
  onRiskChange?: (risk: number) => void
  hangup?: () => void
  defaultMode?: Mode
  defaultLang?: UILang | "auto"
  defaultAutoMuteMic?: boolean
  defaultVoiceCoach?: boolean
  highRiskThreshold?: number
  autoHangupOnHighRisk?: boolean
}

export function CallGuard({
  remoteStream = null,
  onHighRisk,
  onRiskChange,
  hangup,
  defaultMode = "mic",
  defaultLang = "auto",
  defaultAutoMuteMic = true,
  defaultVoiceCoach = true,
  highRiskThreshold = 50,
  autoHangupOnHighRisk = true,
}: Props) {
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [mode, setMode] = useState<Mode>(defaultMode)
  const [lang, setLang] = useState<UILang | "auto">(defaultLang)
  const [autoDetectedLang, setAutoDetectedLang] = useState<UILang>("en")

  const [transcript, setTranscript] = useState("")
  const [interim, setInterim] = useState("")
  const [remoteTranscript, setRemoteTranscript] = useState("")

  const [scamScore, setScamScore] = useState(0)
  const [cloneScore, setCloneScore] = useState(0)
  const [localReasons, setLocalReasons] = useState<string[]>([])
  const [localEvidence, setLocalEvidence] = useState<{ category: string; snippet: string }[]>([])
  const [serverReasons, setServerReasons] = useState<string[]>([])

  const [volume, setVolume] = useState(0)
  const [discreetBeep, setDiscreetBeep] = useState(true)
  const [autoMuteMic, setAutoMuteMic] = useState(defaultAutoMuteMic)
  const [voiceCoach, setVoiceCoach] = useState(defaultVoiceCoach)
  const [voiceCoachElevenLabs, setVoiceCoachElevenLabs] = useState(false)

  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null)
  const [ttsServerAvailable, setTtsServerAvailable] = useState<boolean | null>(null)
  const [remoteAsrAvailable, setRemoteAsrAvailable] = useState<boolean | null>(null)
  const [remoteAsrEnabled, setRemoteAsrEnabled] = useState<boolean>(true)

  const [classifyBusy, setClassifyBusy] = useState(false)
  const lastClassifyAt = useRef(0)

  const [displayCaptureAllowed, setDisplayCaptureAllowed] = useState<boolean>(true)
  const [systemCaptureBlocked, setSystemCaptureBlocked] = useState<string | null>(null)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const sysStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(remoteStream)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const procRef = useRef<ScriptProcessorNode | null>(null)
  const remoteSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const sysSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)

  const lastBeepAtRef = useRef(0)
  const recogRef = useRef<any>(null)

  const remoteRecorderRef = useRef<MediaRecorder | null>(null)
  const remoteAsrBusyRef = useRef(false)

  const sessionRef = useRef<{ startedAt?: Date; endedAt?: Date }>({})

  const [mutedByGuard, setMutedByGuard] = useState(false)

  const currentLang = useMemo<UILang>(() => (lang === "auto" ? autoDetectedLang : lang), [lang, autoDetectedLang])
  const combinedTranscript = useMemo(() => {
    const merged = [transcript, remoteTranscript].filter(Boolean).join(" ")
    return merged
  }, [transcript, remoteTranscript])

  const risk = Math.round(0.65 * scamScore + 0.35 * cloneScore)
  const riskColor =
    risk >= 80 ? "bg-[#B3261E]" : risk >= 60 ? "bg-[#E4690B]" : risk >= 35 ? "bg-[#F2B8B5]" : "bg-[#1DB954]"
  const HIGH_THRESHOLD = highRiskThreshold

  const [speechSupported, setSpeechSupported] = useState<boolean>(true)
  useEffect(() => {
    const supported = Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    setSpeechSupported(supported)
  }, [])

  useEffect(() => {
    function checkDisplayCaptureAllowed(): boolean {
      try {
        const anyDoc: any = document as any
        const policy = anyDoc.permissionsPolicy || anyDoc.featurePolicy
        if (policy?.allowsFeature) return policy.allowsFeature("display-capture")
        if (policy?.features && typeof policy.features === "function") {
          const feats: string[] = policy.features()
          return feats.includes("display-capture")
        }
      } catch {}
      return typeof (navigator.mediaDevices as any)?.getDisplayMedia === "function"
    }
    setDisplayCaptureAllowed(checkDisplayCaptureAllowed())
  }, [])

  // Probe server endpoints (AI SDK, TTS, Remote ASR)
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch("/api/classify", { method: "OPTIONS" })
        if (!mounted) return
        setServerAvailable(res.ok)
      } catch {
        if (mounted) setServerAvailable(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch("/api/tts", { method: "OPTIONS" })
        if (!mounted) return
        setTtsServerAvailable(res.ok)
        setVoiceCoachElevenLabs(res.ok)
      } catch {
        if (mounted) setTtsServerAvailable(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch("/api/remote-asr", { method: "OPTIONS" })
        if (!mounted) return
        setRemoteAsrAvailable(res.ok)
        setRemoteAsrEnabled(res.ok)
      } catch {
        if (mounted) {
          setRemoteAsrAvailable(false)
          setRemoteAsrEnabled(false)
        }
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    return () => stopMonitoring()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    remoteStreamRef.current = remoteStream || null
    if (!isMonitoring) return
    const ctx = audioCtxRef.current
    const analyser = analyserRef.current
    if (!ctx || !analyser) return

    try {
      remoteSourceRef.current?.disconnect()
    } catch {}
    remoteSourceRef.current = null

    if (remoteStreamRef.current) {
      try {
        const src = ctx.createMediaStreamSource(remoteStreamRef.current)
        src.connect(analyser)
        remoteSourceRef.current = src
      } catch {}

      stopRemoteAsr()
      startRemoteAsrIfNeeded()
    } else {
      stopRemoteAsr()
    }
  }, [remoteStream, isMonitoring])

  const lastRiskRef = useRef(0)
  useEffect(() => {
    onRiskChange?.(risk)
    const crossedUp = lastRiskRef.current < HIGH_THRESHOLD && risk >= HIGH_THRESHOLD
    lastRiskRef.current = risk

    if (crossedUp) {
      const reasons = [...new Set([...localReasons, ...serverReasons])]
      onHighRisk?.(risk, reasons)
      uiBeep()
      if (voiceCoach) speakCoach()
      if (autoMuteMic && micStreamRef.current) {
        const track = micStreamRef.current.getAudioTracks()[0]
        if (track && track.enabled) {
          track.enabled = false
          setMutedByGuard(true)
        }
      }
      if (autoHangupOnHighRisk && typeof hangup === "function") {
        setTimeout(() => {
          try {
            hangup()
          } catch {}
        }, 500)
      }
    }
  }, [
    risk,
    autoHangupOnHighRisk,
    autoMuteMic,
    hangup,
    localReasons,
    onHighRisk,
    onRiskChange,
    serverReasons,
    voiceCoach,
  ]) // eslint-disable-line react-hooks/exhaustive-deps

  function uiBeep() {
    if (!discreetBeep) return
    const now = Date.now()
    if (now - lastBeepAtRef.current < 3000) return
    try {
      const ctx = audioCtxRef.current || new AudioContext()
      audioCtxRef.current = ctx
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = 880
      gain.gain.value = 0.06
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.12)
      lastBeepAtRef.current = now
      if ("vibrate" in navigator) {
        try {
          ;(navigator as any).vibrate?.(100)
        } catch {}
      }
    } catch {}
  }

  async function speakCoach() {
    const text =
      currentLang === "es"
        ? "Alerta: posible estafa. No comparta códigos ni datos bancarios. Cuelgue y verifique con un número oficial."
        : currentLang === "fr"
          ? "Alerte: possible arnaque. Ne partagez pas de codes ni d'informations bancaires. Raccrochez et vérifiez via un numéro officiel."
          : currentLang === "de"
            ? "Warnung: möglicher Betrug. Keine Codes oder Bankdaten teilen. Auflegen und über eine offizielle Nummer verifizieren."
            : "Alert: this may be a scam. Do not share codes or bank details. Hang up and call back on an official number."
    try {
      if (voiceCoachElevenLabs && ttsServerAvailable) {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, lang: currentLang }),
        })
        if (!res.ok) throw new Error("TTS failed")
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audio.volume = 0.85
        await audio.play().catch(() => {})
        setTimeout(() => URL.revokeObjectURL(url), 5000)
      } else {
        const s = window.speechSynthesis
        if (!s) return
        const msg = new SpeechSynthesisUtterance(text)
        msg.rate = 1.05
        msg.volume = 0.95
        s.cancel()
        s.speak(msg)
      }
    } catch {
      // ignore coaching failures
    }
  }

  async function startMonitoring() {
    if (isMonitoring) return
    reset()
    setSystemCaptureBlocked(null)
    sessionRef.current.startedAt = new Date()
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    audioCtxRef.current = ctx

    if (mode === "mic" || mode === "both") {
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      })
    }
    if (mode === "system" || mode === "both") {
      if (!displayCaptureAllowed) {
        setSystemCaptureBlocked("System/Tab capture is blocked here. Falling back to Microphone-only.")
        if (mode === "system") setMode("mic")
      } else {
        try {
          sysStreamRef.current = await (navigator.mediaDevices as any).getDisplayMedia({ audio: true, video: true })
        } catch (err: any) {
          const msg =
            err?.name === "NotAllowedError" || String(err?.message || "").includes("display-capture")
              ? "System/Tab capture was denied. Continuing with Microphone."
              : "System/Tab capture failed. Continuing with Microphone."
          setSystemCaptureBlocked(msg)
          if (mode === "system") setMode("mic")
          sysStreamRef.current = null
        }
      }
    }

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.85
    analyserRef.current = analyser

    const zeroGain = ctx.createGain()
    zeroGain.gain.value = 0
    zeroGain.connect(ctx.destination)

    if (micStreamRef.current) {
      const src = ctx.createMediaStreamSource(micStreamRef.current)
      src.connect(analyser)
      src.connect(zeroGain)
      micSourceRef.current = src
    }
    if (sysStreamRef.current) {
      try {
        const src = ctx.createMediaStreamSource(sysStreamRef.current)
        src.connect(analyser)
        src.connect(zeroGain)
        sysSourceRef.current = src
      } catch {}
    }
    if (remoteStreamRef.current) {
      try {
        const src = ctx.createMediaStreamSource(remoteStreamRef.current)
        src.connect(analyser)
        remoteSourceRef.current = src
      } catch {}
    }

    const proc = ctx.createScriptProcessor(2048, 1, 1)
    procRef.current = proc
    proc.onaudioprocess = () => {
      const a = analyserRef.current
      if (!a) return

      const td = new Uint8Array(a.fftSize)
      a.getByteTimeDomainData(td)
      let sum = 0
      for (let i = 0; i < td.length; i++) {
        const v = (td[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / td.length)
      setVolume(Math.min(100, Math.round(rms * 180)))

      const fbuf = new Float32Array(td.length)
      for (let i = 0; i < td.length; i++) fbuf[i] = (td[i] - 128) / 128
      const metrics = computeCloneLikelihood(fbuf, a.context.sampleRate)
      if (metrics) {
        const suspicion = Math.round(
          100 *
            (0.6 * metrics.cloneLikelihood +
              0.25 * (1 - Math.min(1, Math.abs(metrics.jitterRatio))) +
              0.15 * metrics.flatness),
        )
        setCloneScore((prev) => Math.round(prev * 0.85 + Math.min(100, suspicion) * 0.15))
      }
    }

    const g = ctx.createGain()
    g.gain.value = 0
    g.connect(proc)
    proc.connect(ctx.destination)

    bootSpeechRecognition()
    startRemoteAsrIfNeeded()

    setIsMonitoring(true)
  }

  function stopMonitoring() {
    setIsMonitoring(false)
    sessionRef.current.endedAt = new Date()
    try {
      recogRef.current?.stop()
    } catch {}
    recogRef.current = null
    try {
      procRef.current?.disconnect()
    } catch {}
    procRef.current = null
    try {
      analyserRef.current?.disconnect()
    } catch {}
    analyserRef.current = null

    try {
      micSourceRef.current?.disconnect()
      sysSourceRef.current?.disconnect()
      remoteSourceRef.current?.disconnect()
    } catch {}

    micSourceRef.current = null
    sysSourceRef.current = null
    remoteSourceRef.current = null

    micStreamRef.current?.getTracks().forEach((t) => (t.stop(), (t.enabled = true)))
    sysStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current = null
    sysStreamRef.current = null
    setMutedByGuard(false)

    stopRemoteAsr()

    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
  }

  function reset() {
    setTranscript("")
    setInterim("")
    setRemoteTranscript("")
    setScamScore(0)
    setCloneScore(0)
    setLocalReasons([])
    setLocalEvidence([])
    setServerReasons([])
    setMutedByGuard(false)
  }

  function bootSpeechRecognition() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setSpeechSupported(false)
      return
    }
    const recog = new SpeechRecognition()
    recog.lang = mapUILangToBCP47(currentLang)
    recog.continuous = true
    recog.interimResults = true

    recog.onresult = (event: any) => {
      let finalText = ""
      let interimText = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i]
        if (res.isFinal) finalText += res[0].transcript + " "
        else interimText += res[0].transcript + " "
      }
      if (finalText) {
        setTranscript((prev) => {
          const nextAll = (prev + " " + finalText).trim()

          if (lang === "auto") {
            const det = detectLanguageCode((nextAll + " " + remoteTranscript).trim())
            if (det) setAutoDetectedLang(det)
          }

          analyzeTextWindow(nextAll, remoteTranscript)
          maybeServerClassify((nextAll + " " + remoteTranscript).slice(-1800))
          return nextAll
        })
      }
      setInterim(interimText)
    }
    recog.onerror = () => {}
    recog.onend = () => {
      if (isMonitoring) {
        try {
          recog.start()
        } catch {}
      }
    }
    recogRef.current = recog
    try {
      recog.start()
    } catch {}
  }

  function analyzeTextWindow(local: string, remote: string) {
    const windowText = (local + " " + remote).slice(-1200)
    const analysis: AnalysisResult = analyzeScamText(windowText, currentLang)
    setLocalReasons(analysis.reasons)
    setLocalEvidence(
      analysis.hits.slice(0, 12).map((h) => ({ category: h.category, snippet: h.snippet.replace(/\s+/g, " ") })),
    )
    setScamScore((prevScore) => Math.round(prevScore * 0.3 + analysis.score * 0.7))
  }

  async function maybeServerClassify(text: string) {
    if (serverAvailable === false) return
    const now = Date.now()
    if (now - lastClassifyAt.current < 1800) return
    lastClassifyAt.current = now
    setClassifyBusy(true)
    try {
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(-1600), lang: currentLang }),
      })
      const data = (await res.json()) as ClassifyResponse
      if (data.ok && typeof data.scam_score === "number") {
        const s = Math.round(data.scam_score * 100)
        setScamScore((prev) => Math.round(prev * 0.6 + s * 0.4))
        setServerReasons(Array.isArray(data.top_reasons) ? data.top_reasons.slice(0, 3) : [])
      } else {
        setServerReasons([])
      }
    } catch {
      // ignore
    } finally {
      setClassifyBusy(false)
    }
  }

  function mapUILangToBCP47(l: UILang) {
    switch (l) {
      case "en":
        return "en-US"
      case "es":
        return "es-ES"
      case "fr":
        return "fr-FR"
      case "de":
        return "de-DE"
      default:
        return "en-US"
    }
  }

  function startRemoteAsrIfNeeded() {
    if (!isMonitoring) return
    if (!remoteAsrEnabled || remoteAsrAvailable === false) return
    const rs = remoteStreamRef.current
    if (!rs) return
    if (!rs.getAudioTracks().length) return
    if (remoteRecorderRef.current) return

    try {
      const mime =
        typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm"
      const rec = new MediaRecorder(rs, { mimeType: mime, audioBitsPerSecond: 32000 })
      rec.ondataavailable = async (ev) => {
        const blob = ev.data
        if (!blob || blob.size < 1024) return
        if (remoteAsrBusyRef.current) return
        remoteAsrBusyRef.current = true
        try {
          const url = `/api/remote-asr?lang=${encodeURIComponent(currentLang)}`
          const res = await fetch(url, { method: "POST", body: blob })
          const data = await res.json().catch(() => null)
          if (data?.ok && data.text) {
            setRemoteTranscript((prev) => {
              const next = (prev + " " + data.text).trim()
              if (lang === "auto") {
                const det = detectLanguageCode((transcript + " " + next).trim())
                if (det) setAutoDetectedLang(det)
              }
              analyzeTextWindow(transcript, next)
              maybeServerClassify((transcript + " " + next).slice(-1800))
              return next
            })
          }
        } catch {
          // ignore ASR chunk errors
        } finally {
          remoteAsrBusyRef.current = false
        }
      }
      rec.start(4000)
      remoteRecorderRef.current = rec
    } catch {
      // ignore
    }
  }

  function stopRemoteAsr() {
    try {
      remoteRecorderRef.current?.stop()
    } catch {}
    remoteRecorderRef.current = null
    remoteAsrBusyRef.current = false
  }

  function downloadReport() {
    const md = buildReportMarkdown({
      startedAt: sessionRef.current.startedAt,
      endedAt: new Date(),
      language: currentLang,
      overallRisk: risk,
      scamScore,
      cloneScore,
      reasons: [...new Set([...localReasons, ...serverReasons])],
      evidence: localEvidence,
      transcript: combinedTranscript,
    })
    const ts = new Date().toISOString().replace(/[:.]/g, "-")
    downloadText(`call-guard-report-${ts}.md`, md)
  }

  function unmuteMic() {
    if (!micStreamRef.current) return
    const track = micStreamRef.current.getAudioTracks()[0]
    if (track) {
      track.enabled = true
      setMutedByGuard(false)
    }
  }

  const combinedReasons = [...new Set([...localReasons, ...serverReasons])]
  const remoteAsrActive = remoteAsrEnabled && remoteAsrAvailable !== false && Boolean(remoteStreamRef.current)

  return (
    <div className="space-y-4">
      <Card className="rounded-3xl border-[#E7E0EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.06)]">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium text-[#1D1B20]">Audio</Label>
              <Select
                value={mode}
                onValueChange={(v) => {
                  if ((v === "system" || v === "both") && !displayCaptureAllowed) {
                    setSystemCaptureBlocked("System/Tab capture isn’t allowed in this preview. Using Microphone.")
                    setMode("mic")
                  } else {
                    setSystemCaptureBlocked(null)
                    setMode(v as Mode)
                  }
                }}
              >
                <SelectTrigger className="w-[220px] rounded-full border-[#E7E0EC]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-[#E7E0EC]">
                  <SelectItem value="mic">
                    <div className="flex items-center gap-2">
                      <Mic className="h-4 w-4" />
                      <span className="font-medium">Microphone</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="system" disabled={!displayCaptureAllowed}>
                    <div className="flex items-center gap-2 opacity-90">
                      <MonitorSmartphone className="h-4 w-4" />
                      <span className="font-medium">System/Tab {displayCaptureAllowed ? "" : "(unavailable)"}</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="both" disabled={!displayCaptureAllowed}>
                    <div className="flex items-center gap-2 opacity-90">
                      <Activity className="h-4 w-4" />
                      <span className="font-medium">Both {displayCaptureAllowed ? "" : "(unavailable)"}</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium text-[#1D1B20]">Language</Label>
              <Select value={lang} onValueChange={(v) => setLang(v as UILang | "auto")}>
                <SelectTrigger className="w-[180px] rounded-full border-[#E7E0EC]">
                  <SelectValue placeholder="Language" />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-[#E7E0EC]">
                  <SelectItem value="auto">
                    <div className="flex items-center gap-2">
                      <Languages className="h-4 w-4" />
                      <span className="font-medium">Auto</span>
                    </div>
                  </SelectItem>
                  {supportedLangs
                    .filter((l) => ["en", "es", "fr", "de"].includes(l))
                    .map((l) => (
                      <SelectItem key={l} value={l}>
                        <span className="uppercase font-medium">{l}</span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {lang === "auto" ? (
                <Badge className="ml-1 rounded-full bg-[#E7E0EC] text-[#1D1B20] border border-[#CAC4D0]">
                  {autoDetectedLang.toUpperCase()}
                </Badge>
              ) : null}
            </div>

            <div className="flex items-center gap-3 ml-auto">
              <div className="flex items-center gap-2">
                <Switch checked={discreetBeep} onCheckedChange={setDiscreetBeep} />
                <Label className="text-sm font-medium text-[#1D1B20] flex items-center gap-1">
                  <Bell className="h-4 w-4 text-[#6750A4]" />
                  Discreet alert
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={voiceCoach} onCheckedChange={setVoiceCoach} />
                <Label className="text-sm font-medium text-[#1D1B20] flex items-center gap-1">
                  <MessageCircleWarning className="h-4 w-4 text-[#6750A4]" />
                  Vocal instructor
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={remoteAsrEnabled}
                  disabled={remoteAsrAvailable === false || !remoteStreamRef.current}
                  onCheckedChange={(v) => {
                    setRemoteAsrEnabled(Boolean(v))
                    if (v) startRemoteAsrIfNeeded()
                    else stopRemoteAsr()
                  }}
                />
                <Label className="text-sm font-medium text-[#1D1B20] flex items-center gap-1">
                  <Waveform className="h-4 w-4 text-[#6750A4]" />
                  Transcribe caller (server)
                </Label>
                {remoteAsrActive ? (
                  <Badge className="rounded-full bg-[#EADDFF] text-[#21005D] border border-[#CAC4D0]">ON</Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={autoMuteMic} onCheckedChange={setAutoMuteMic} />
                <Label className="text-sm font-medium text-[#1D1B20]">Auto-mute mic</Label>
              </div>

              <Button
                onClick={isMonitoring ? stopMonitoring : startMonitoring}
                variant={isMonitoring ? "destructive" : "default"}
                className={`rounded-full ${
                  isMonitoring
                    ? "bg-[#B3261E] hover:bg-[#8C1D18] text-white"
                    : "bg-[#6750A4] hover:bg-[#5B409D] text-white"
                }`}
              >
                {isMonitoring ? "Stop" : "Start"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-[#E7E0EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.06)]">
        <CardContent className="p-4 space-y-3">
          {!remoteAsrActive && (!speechSupported || mode === "system") ? (
            <Alert className="border-l-4 border-l-[#6750A4] rounded-2xl">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle className="font-medium text-[#1D1B20]">Caller transcription may be inactive</AlertTitle>
              <AlertDescription className="text-sm text-[#49454F]">
                To detect scam from the caller’s words, enable “Transcribe caller (server)” and pass your remote
                MediaStream.
              </AlertDescription>
            </Alert>
          ) : null}

          {systemCaptureBlocked ? (
            <Alert className="border-l-4 border-l-[#6750A4] rounded-2xl">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle className="font-medium text-[#1D1B20]">System/Tab capture unavailable</AlertTitle>
              <AlertDescription className="text-sm text-[#49454F]">{systemCaptureBlocked}</AlertDescription>
            </Alert>
          ) : null}

          {risk >= HIGH_THRESHOLD ? (
            <Alert className="rounded-2xl border-l-4 border-l-[#B3261E] bg-[#FFF8F7]">
              <ShieldAlert className="h-4 w-4 text-[#B3261E]" />
              <AlertTitle className="font-medium text-[#1D1B20]">Likely scam call detected</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5 space-y-1">
                  {([...new Set([...localReasons, ...serverReasons])].slice(0, 5) as string[]).map((r, i) => (
                    <li key={i} className="text-sm text-[#49454F]">
                      {r}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  {hangup ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-2 rounded-full bg-[#B3261E] hover:bg-[#8C1D18] text-white"
                      onClick={hangup}
                    >
                      <PhoneOff className="h-4 w-4" />
                      Hang up now
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    onClick={downloadReport}
                    className="gap-2 rounded-full bg-[#E7E0EC] hover:bg-[#D0C6D7] text-[#1D1B20] border border-[#CAC4D0]"
                    variant="secondary"
                  >
                    <Download className="h-4 w-4" />
                    Download report
                  </Button>
                  {mutedByGuard ? (
                    <Button
                      size="sm"
                      onClick={unmuteMic}
                      className="gap-2 rounded-full border border-[#79747E] text-[#1D1B20] bg-white"
                      variant="outline"
                    >
                      <MicOff className="h-4 w-4" />
                      Unmute mic
                    </Button>
                  ) : null}
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`h-3 w-3 rounded-full ${riskColor}`} />
              <span className="text-sm font-medium text-[#1D1B20]">Overall Risk</span>
            </div>
            <Badge
              className={`rounded-full border ${
                risk >= HIGH_THRESHOLD
                  ? "bg-[#FFDAD4] text-[#410E0B] border-[#F2B8B5]"
                  : risk >= 40
                    ? "bg-[#EADDFF] text-[#21005D] border-[#CAC4D0]"
                    : "bg-[#E7E0EC] text-[#1D1B20] border-[#CAC4D0]"
              }`}
            >
              {risk}%
            </Badge>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between text-xs text-[#49454F]">
                <span className="font-medium text-[#1D1B20]">Scam intent</span>
                <span>{scamScore}%</span>
              </div>
              <Progress value={scamScore} className="mt-1" />
            </div>
            <div>
              <div className="flex items-center justify-between text-xs text-[#49454F]">
                <span className="font-medium text-[#1D1B20]">Synthetic voice</span>
                <span>{cloneScore}%</span>
              </div>
              <Progress value={cloneScore} className="mt-1" />
            </div>
          </div>

          {combinedReasons.length > 0 ? (
            <div>
              <div className="text-xs font-medium text-[#1D1B20] mb-1">Why flagged</div>
              <ul className="text-xs text-[#49454F] list-disc pl-5 space-y-1">
                {combinedReasons.slice(0, 6).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[#E7E0EC] bg-white p-2">
              <div className="text-[10px] text-[#49454F] mb-1 font-medium">Evidence (snippets)</div>
              <ul className="text-xs space-y-1 max-h-28 overflow-auto">
                {localEvidence.length ? (
                  localEvidence.map((e, i) => (
                    <li key={i}>
                      <span className="font-medium text-[#1D1B20]">[{e.category}]</span>{" "}
                      <span className="text-[#49454F]">{e.snippet}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-[#49454F]">No explicit sensitive requests detected yet.</li>
                )}
              </ul>
            </div>

            <div className="rounded-2xl border border-[#E7E0EC] bg-white p-2">
              <div className="text-[10px] text-[#49454F] mb-1 font-medium">Transcript (caller + you)</div>
              <div className="text-xs max-h-28 overflow-auto text-[#49454F]">
                <span className="whitespace-pre-wrap">{(combinedTranscript + " " + interim).slice(-800)}</span>
              </div>
              <div className="mt-2 text-[10px] text-[#49454F] flex items-center gap-2">
                <Volume2 className="h-3.5 w-3.5" />
                Live level: {volume}%
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tonal floating indicator (M3 primary container) */}
      <div className="fixed bottom-4 right-4 z-50">
        <div className="rounded-full border border-[#CAC4D0] bg-[#EADDFF] px-3 py-2 shadow-lg flex items-center gap-2">
          <div className={`h-2.5 w-2.5 rounded-full ${riskColor}`} />
          <span className="text-xs font-medium text-[#21005D]">Call Guard</span>
          <span className="text-xs text-[#21005D]">{risk}%</span>
        </div>
      </div>
    </div>
  )
}
