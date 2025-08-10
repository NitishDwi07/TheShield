// Lightweight DSP heuristics for synthetic voice likelihood estimation.
// WARNING: These are heuristic and NOT definitive deepfake detectors.

export type CloneMetrics = {
  pitchHz: number
  jitterRatio: number // relative short-term pitch variability
  zcr: number // zero crossing rate
  flatness: number // spectral flatness proxy via simple band energy ratio
  lowVarVoicing: number // 0..1 lower variance = more "synthetic-like" steady tone
  cloneLikelihood: number // 0..1 composite
}

// Autocorrelation-based pitch detection (naive)
function detectPitch(buf: Float32Array, sampleRate: number): number {
  const size = buf.length
  let bestOffset = -1
  let bestCorr = 0
  let rms = 0
  for (let i = 0; i < size; i++) {
    const val = buf[i]
    rms += val * val
  }
  rms = Math.sqrt(rms / size)
  if (rms < 0.01) return 0
  const MAX_DISC = Math.floor(sampleRate / 80) // 80 Hz
  const MIN_DISC = Math.floor(sampleRate / 400) // 400 Hz
  let lastCorr = 1
  for (let offset = MIN_DISC; offset <= MAX_DISC; offset++) {
    let corr = 0
    for (let i = 0; i < size - offset; i++) {
      corr += buf[i] * buf[i + offset]
    }
    corr = corr / (size - offset)
    if (corr > bestCorr && corr > lastCorr) {
      bestCorr = corr
      bestOffset = offset
    }
    lastCorr = corr
  }
  if (bestOffset === -1) return 0
  const freq = sampleRate / bestOffset
  if (freq < 60 || freq > 500) return 0
  return freq
}

function zeroCrossingRate(buf: Float32Array): number {
  let z = 0
  for (let i = 1; i < buf.length; i++) {
    if ((buf[i - 1] >= 0 && buf[i] < 0) || (buf[i - 1] < 0 && buf[i] >= 0)) z++
  }
  return z / buf.length
}

function spectralFlatnessProxy(buf: Float32Array): number {
  // Very crude: ratio of mid-high band energy to total
  const n = buf.length
  let low = 0
  let high = 0
  for (let i = 0; i < n; i++) {
    const v = buf[i]
    const abs = Math.abs(v)
    if (i < n * 0.2) low += abs
    else high += abs
  }
  const total = low + high + 1e-6
  return Math.min(1, Math.max(0, high / total))
}

export function computeCloneLikelihood(buf: Float32Array, sampleRate: number): CloneMetrics | null {
  if (!buf || buf.length < 512) return null
  const pitch = detectPitch(buf, sampleRate)
  const zcr = zeroCrossingRate(buf)
  const flatness = spectralFlatnessProxy(buf)

  // Jitter approximation: compare pitch between two halves
  const mid = Math.floor(buf.length / 2)
  const p1 = detectPitch(buf.subarray(0, mid), sampleRate) || pitch
  const p2 = detectPitch(buf.subarray(mid), sampleRate) || pitch
  const jitter = pitch > 0 ? Math.abs(p1 - p2) / pitch : 1

  // Low variance voicing proxy
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1)
  const m = mean(buf as any)
  let variance = 0
  for (let i = 0; i < buf.length; i++) {
    const d = buf[i] - m
    variance += d * d
  }
  variance = variance / buf.length
  const lowVarVoicing = Math.max(0, Math.min(1, 1 - Math.tanh(variance * 50)))

  // Composite likelihood: encourage steady pitch (low jitter), medium-low ZCR, and high flatness (robotic timbre)
  let cloneLikelihood = 0.0
  cloneLikelihood += (1 - Math.min(1, jitter)) * 0.45
  cloneLikelihood += Math.max(0, flatness - 0.4) * 0.35
  cloneLikelihood += Math.max(0, 0.3 - Math.abs(zcr - 0.1)) * 0.2

  return {
    pitchHz: pitch || 0,
    jitterRatio: jitter,
    zcr,
    flatness,
    lowVarVoicing,
    cloneLikelihood: Math.min(1, Math.max(0, cloneLikelihood)),
  }
}
