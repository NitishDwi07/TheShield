export type ReportParams = {
  startedAt?: Date
  endedAt?: Date
  language: string
  overallRisk: number
  scamScore: number
  cloneScore: number
  reasons: string[]
  evidence: { category: string; snippet: string }[]
  transcript: string
}

export function buildReportMarkdown(p: ReportParams) {
  const started = p.startedAt ? p.startedAt.toISOString() : ""
  const ended = p.endedAt ? p.endedAt.toISOString() : ""
  const lines: string[] = []
  lines.push(`# Call Guard Report`)
  lines.push("")
  lines.push(`- Started: ${started}`)
  lines.push(`- Ended: ${ended}`)
  lines.push(`- Language: ${p.language.toUpperCase()}`)
  lines.push(`- Overall Risk: ${p.overallRisk}%`)
  lines.push(`- Scam Intent: ${p.scamScore}%`)
  lines.push(`- Synthetic Voice Likelihood: ${p.cloneScore}%`)
  lines.push("")
  lines.push(`## Why this call was flagged`)
  if (p.reasons.length) {
    for (const r of p.reasons) lines.push(`- ${r}`)
  } else {
    lines.push(`- No specific reasons captured (heuristic only).`)
  }
  if (p.evidence.length) {
    lines.push("")
    lines.push(`## Evidence snippets`)
    for (const e of p.evidence.slice(0, 12)) {
      lines.push(`- [${e.category}] “…${e.snippet}…”`)
    }
  }
  lines.push("")
  lines.push(`## Recommendations`)
  lines.push(`- Do not share OTPs, account, or card details over calls.`)
  lines.push(`- Hang up and call the institution back using an official number.`)
  lines.push(`- Do not install remote access tools on request.`)
  lines.push("")
  lines.push(`## Transcript (last 1000 chars)`)
  lines.push("```")
  lines.push(p.transcript.slice(-1000))
  lines.push("```")
  lines.push("")
  return lines.join("\n")
}

export function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
