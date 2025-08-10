# 🛡️ TheShield

**AI-Powered Voice Scam Alert System**  
Built in just **16 hours** for Hack-Nation's GLOBAL AI HACKATHON in collaboration with MIT Sloan AI Club — TheShield listens to call audio, detects scam patterns in real time, and warns the user before it’s too late.

---

## 🚀 Overview

Voice scams are becoming more sophisticated — using convincing language and psychological tricks to pressure victims into taking action.  
**TheShield** is your AI-powered defense: it transcribes conversations, detects suspicious language patterns, and issues instant alerts via both visual cues and spoken warnings.

**Demo scenario:**  
Safe chat → Suspicious phrases → Confirmed scam 🚨

---

## ✨ Features

- 🎙 **Live Audio Monitoring** — Capture or play audio in real time.
- 📝 **AI Transcription** — Powered by [OpenAI Whisper API](https://platform.openai.com/docs/guides/speech-to-text).
- 🤖 **Scam Classification** — GPT-4-based Safe / Suspicious / Scam detection with reasoning.
- 🎨 **Visual Risk Alerts** — Color-coded status:  
  - 🟢 **Safe**  
  - 🟠 **Suspicious**  
  - 🔴 **Scam**
- 🔊 **Voice Warnings** — [ElevenLabs](https://elevenlabs.io/) TTS for spoken alerts.
- 🌍 **Multi-language Support** — Detect scams in English, Spanish, French (and extendable to more).

---

## 🏗 Architecture

```plaintext
Frontend (Next.js / React / TypeScript)
│
├── UI: StatusIndicator, TranscriptView, ReportList
├── Audio: Recorder → Whisper API → Transcription
├── GPT-4 Mini: Scam Classification (Risk % + Reason)
└── Alerts: Visual + TTS via ElevenLabs

TheShield/
├── app/             # App entry & page routing
├── components/      # Reusable UI components
├── hooks/           # Custom logic hooks
├── lib/             # API utilities & helpers
├── public/          # Static assets (demo audio, icons)
├── styles/          # CSS modules & global styles
├── package.json     # Dependencies & scripts
├── tsconfig.json    # TypeScript configuration
└── next.config.mjs  # Next.js configuration

```


## ⚡ Getting Started

### 1️⃣ Clone & Install
```bash
git clone https://github.com/NitishDwi07/TheShield.git
cd TheShield
npm install
```

### 2️⃣ Environment Variables
```bash
OPENAI_API_KEY=your_openai_key
ELEVENLABS_API_KEY=your_elevenlabs_key  # optional for TTS
```

### 3️⃣ Run Development Server
```bash
npm run dev
```

<p align="center"><b>Made with ❤️ by Team Crystal</b></p>




