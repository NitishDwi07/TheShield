# TheShield 🛡️

A modern, real-time scam call detection and reporting platform leveraging AI-powered speech and text analysis with a full-stack web application for individuals and organizations.

## 🎯 Overview

TheShield is an intelligent security tool designed to detect scam calls and prevent phone fraud. It combines rule-based heuristics and advanced APIs—including OpenAI and ElevenLabs—for speech-to-text, text classification, and voice analysis. The platform generates detailed risk reports with actionable recommendations, helping users stay protected from social engineering attacks and fraudulent calls. It also provides an auto Call cut-off feature when the risk level crosses a certain threshold level.

## 🏗️ Project Structure

```
TheShield/
├── app/                       # Next.js application (frontend & API routes)
│   ├── api/                   # Serverless API endpoints (speech, classify)
│   └── layout.tsx             # Root layout for UI
├── components/                # React UI components (charts, carousel, sheet, sidebar, etc.)
├── lib/                       # Core business logic
│   ├── report.ts              # Report generation utilities
│   ├── scam-rules.ts          # Scam detection rules & analysis
├── public/                    # Static assets
├── styles/                    # Global styles & Tailwind config
├── next.config.mjs            # Next.js configuration
├── postcss.config.mjs         # PostCSS & Tailwind config
├── package.json               # Project dependencies
└── README.md                  # Project documentation
```

## 🚀 Features

### AI & Voice APIs
- **Speech-to-Text (ASR)**: Converts call audio to text using OpenAI APIs
- **Text Classification**: Detects scam signals in transcripts via OpenAI GPT models
- **Text-to-Speech & Voice Analysis**: Uses ElevenLabs APIs for TTS and synthetic voice detection

### Detection & Reporting
- **Rule-Based & AI Hybrid Detection**: Flags suspicious activity, urgency, code requests, remote-access attempts, and more
- **Risk Scoring**: Provides scam likelihood, synthetic voice probability, and evidence categorization
- **Actionable Recommendations**: User guidance to prevent fraud (e.g., don’t share OTPs, don’t install remote tools)
- **Report Generation & Download**: Markdown reports summarizing risks and evidence

### Web Application
- **Frontend**: Responsive React/Next.js UI with interactive charts (Recharts) and advanced components
- **Backend**: Next.js API routes for speech, classification, and report generation
- **Security**: Environment-based secret management; endpoints enabled only when properly configured
- **Demo Mode**: Try out scam detection features with sample calls

## 🛠️ Technologies Used

- **TypeScript**: Static typing for reliability
- **React.js & Next.js**: Modern UI and API routing
- **OpenAI API**: Speech-to-text, LLM-based text classification
- **ElevenLabs API**: Text-to-speech, synthetic voice analysis
- **Radix UI & Recharts**: UI primitives and charting
- **Tailwind CSS**: Styling
- **Node.js**: Serverless backend
- **Browser APIs**: Audio and file handling

## 📊 Detection Pipeline

1. **Audio Input**: User uploads or records call audio (webm)
2. **Speech-to-Text**: Audio transcribed via OpenAI API
3. **Transcript Analysis**: Rule-based & LLM-based scam signal detection
4. **Voice Analysis**: ElevenLabs API detects synthetic voice or generates playback
5. **Risk Reporting**: Generates a markdown report with scores, evidence, and recommendations

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+ recommended)
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/NitishDwi07/TheShield.git
   cd TheShield
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   Create a `.env` file in the root directory:
   ```env
   OPENAI_API_KEY=your_openai_api_key
   ELEVENLABS_API_KEY=your_elevenlabs_api_key
   NODE_ENV=development
   ```

4. **Run the application**
   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:3000`

### Demo

- **Watch Demo**: [YouTube Demo](https://youtu.be/6PFKgq_7Cy4?si=dKgIqoMDGhfNJHI7)

## 📈 Usage

- **Upload/Record Audio**: Use the UI to submit call audio for analysis
- **Review Reports**: View risk assessment, evidence, and recommendations
- **Download Reports**: Save markdown summaries for reference
- **Playback**: Listen to synthesized TTS results (via ElevenLabs)

## 🤝 Contributing

We welcome contributions to TheShield! Here’s how:

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/AmazingFeature`)
3. **Make your changes** and add tests if applicable
4. **Commit your changes** (`git commit -m 'Add some AmazingFeature'`)
5. **Push to the branch** (`git push origin feature/AmazingFeature`)
6. **Open a Pull Request**

### Development Guidelines
- Follow existing code style and conventions
- Add comments for complex logic
- Update documentation for new features
- Test your changes thoroughly
- Keep commits atomic and descriptive

## 👥 Team

- **Nitish Dwivedi** - Team Lead.
- **Contributors** - See [Contributors](https://github.com/NitishDwi07/TheShield/contributors)

## 🎯 Future Enhancements

- [ ] Mobile application
- [ ] Advanced scam detection models
- [ ] Real-time alerts and notifications
- [ ] Multilingual support
- [ ] Voice biometric authentication
- [ ] Expanded analytics dashboard
- [ ] SMS/email integration for alerts

---

⭐PS: This project was built during MIT Global AI HAckathon via Team Crystal.

Made with ❤️ for telecommunication security and fraud prevention.
