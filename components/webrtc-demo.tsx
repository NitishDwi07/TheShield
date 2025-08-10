"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Phone, PhoneOff, Mic, Volume2, ShieldAlert } from "lucide-react"
import { CallGuard } from "@/components/call-guard"

type PeerPair = {
  a: RTCPeerConnection | null
  b: RTCPeerConnection | null
}

export function WebRTCDemo() {
  // Simulated call state (loopback)
  const [inCall, setInCall] = useState(false)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [autoHangupOnHighRisk, setAutoHangupOnHighRisk] = useState(true)
  const [lastHighRisk, setLastHighRisk] = useState<number | null>(null)
  const [lastReasons, setLastReasons] = useState<string[]>([])
  const [level, setLevel] = useState(0)

  const peers = useRef<PeerPair>({ a: null, b: null })
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  const meterCtxRef = useRef<AudioContext | null>(null)
  const meterAnalyserRef = useRef<AnalyserNode | null>(null)
  const meterSrcRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const meterRAF = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      stopMeter()
      hangup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startCall() {
    if (inCall) return
    // 1) Get mic
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    })
    setLocalStream(mic)

    // 2) Create two peer connections and wire ICE
    const a = new RTCPeerConnection()
    const b = new RTCPeerConnection()
    a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate).catch(() => {})
    b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate).catch(() => {})

    // 3) Add mic track to A, and capture remote track from B
    for (const track of mic.getAudioTracks()) {
      a.addTrack(track, mic)
    }

    const remote = new MediaStream()
    b.ontrack = (e) => {
      for (const t of e.streams[0].getAudioTracks()) {
        remote.addTrack(t)
      }
      setRemoteStream(remote)
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remote
        // Attempt autoplay
        remoteAudioRef.current.play().catch(() => {})
      }
      startMeter(remote)
    }

    // 4) SDP exchange (loopback)
    const offer = await a.createOffer()
    await a.setLocalDescription(offer)
    await b.setRemoteDescription(offer)
    const answer = await b.createAnswer()
    await b.setLocalDescription(answer)
    await a.setRemoteDescription(answer)

    peers.current = { a, b }
    setInCall(true)
  }

  function stopTracks(ms: MediaStream | null) {
    ms?.getTracks().forEach((t) => {
      try {
        t.stop()
      } catch {}
    })
  }

  function hangup() {
    setInCall(false)
    try {
      peers.current.a?.getSenders().forEach((s) => {
        try {
          s.track?.stop()
        } catch {}
      })
      peers.current.a?.close()
    } catch {}
    try {
      peers.current.b?.close()
    } catch {}
    peers.current = { a: null, b: null }
    stopTracks(localStream)
    stopTracks(remoteStream)
    setLocalStream(null)
    setRemoteStream(null)
    stopMeter()
  }

  function startMeter(stream: MediaStream) {
    try {
      const ctx = meterCtxRef.current || new AudioContext()
      meterCtxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.9
      const src = ctx.createMediaStreamSource(stream)
      src.connect(analyser)
      meterAnalyserRef.current = analyser
      meterSrcRef.current = src

      const loop = () => {
        const a = meterAnalyserRef.current
        if (!a) return
        const td = new Uint8Array(a.fftSize)
        a.getByteTimeDomainData(td)
        let sum = 0
        for (let i = 0; i < td.length; i++) {
          const v = (td[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / td.length)
        setLevel(Math.min(100, Math.round(rms * 180)))
        meterRAF.current = requestAnimationFrame(loop)
      }
      if (!meterRAF.current) {
        meterRAF.current = requestAnimationFrame(loop)
      }
    } catch {
      // ignore
    }
  }

  function stopMeter() {
    if (meterRAF.current) {
      cancelAnimationFrame(meterRAF.current)
      meterRAF.current = null
    }
    try {
      meterSrcRef.current?.disconnect()
    } catch {}
    meterSrcRef.current = null
    try {
      meterAnalyserRef.current?.disconnect()
    } catch {}
    meterAnalyserRef.current = null
    if (meterCtxRef.current) {
      meterCtxRef.current.close().catch(() => {})
      meterCtxRef.current = null
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-emerald-600" />
            Simulated Live Call
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch checked={autoHangupOnHighRisk} onCheckedChange={setAutoHangupOnHighRisk} />
              <Label className="text-sm">Auto hang up on high risk</Label>
            </div>

            <div className="ml-auto flex items-center gap-3">
              {!inCall ? (
                <Button onClick={startCall} className="gap-2">
                  <Phone className="h-4 w-4" />
                  Start Call
                </Button>
              ) : (
                <Button onClick={hangup} variant="destructive" className="gap-2">
                  <PhoneOff className="h-4 w-4" />
                  Hang Up
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded border p-3">
              <div className="text-xs text-muted-foreground mb-2">Remote audio (loopback)</div>
              <audio ref={remoteAudioRef} autoPlay playsInline controls className="w-full" />
              <div className="mt-2 text-[10px] text-muted-foreground flex items-center gap-2">
                <Volume2 className="h-3.5 w-3.5" /> Live level: {level}%
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={inCall ? "default" : "outline"} className="gap-1">
                  <Mic className="h-3.5 w-3.5" />
                  Mic {localStream ? "on" : "off"}
                </Badge>
                {lastHighRisk !== null ? (
                  <Badge variant={lastHighRisk >= 70 ? "destructive" : "secondary"}>Last risk: {lastHighRisk}%</Badge>
                ) : null}
              </div>
            </div>

            <div className="rounded border p-3">
              <div className="text-xs text-muted-foreground mb-2">Why last alert</div>
              {lastReasons.length ? (
                <ul className="text-xs list-disc pl-5 space-y-1">
                  {lastReasons.slice(0, 5).map((r, idx) => (
                    <li key={idx}>{r}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-muted-foreground">No high-risk alert yet.</div>
              )}
              <div className="mt-2 text-[10px] text-muted-foreground flex items-center gap-2">
                <ShieldAlert className="h-3.5 w-3.5" />
                The demo loops your mic back as the “remote” so you can test alerts quickly.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Call Guard</CardTitle>
        </CardHeader>
        <CardContent>
          <CallGuard
            remoteStream={remoteStream || undefined}
            hangup={inCall ? hangup : undefined}
            defaultMode="both"
            defaultAutoMuteMic={true}
            defaultVoiceCoach={true}
            highRiskThreshold={50}
            autoHangupOnHighRisk={autoHangupOnHighRisk}
            onHighRisk={(risk, reasons) => {
              setLastHighRisk(risk)
              setLastReasons(reasons)
              // No manual hangup here; CallGuard will hang up automatically when threshold is crossed
            }}
            onRiskChange={() => {
              // optional: handle risk changes
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
