import { CallGuard } from "@/components/call-guard"
import { Heart } from "lucide-react"

export default function Page() {
  return (
    <main className="min-h-screen bg-[#FFFBFE]">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-medium tracking-tight text-[#1D1B20]">The Shield</h1>
          <p className="text-sm text-[#49454F] mt-1">
            Real-time scam intent and synthetic voice detection during phone or video calls.
          </p>
        </header>

        <CallGuard />

        <footer className="mt-8 border-t border-[#E7E0EC] pt-4 text-xs text-[#49454F]">
          <div className="grid grid-cols-1 sm:grid-cols-1 items-center gap-3">
            

            <div className="flex items-center justify-center gap-2">
              <Heart className="h-3.5 w-3.5 text-rose-500" />
              <span className="text-[#1D1B20]">Powered by Eleven Labs Text-to-Speech Technology</span>
            </div>

            <div className="hidden sm:block" />
          </div>
        </footer>
      </div>
    </main>
  )
}
