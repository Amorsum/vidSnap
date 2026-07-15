export default function Header() {
  return (
    <header className="w-full border-b border-white/10 bg-[#0f0f0f]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#6c5ce7] to-[#00cec9] text-sm font-bold text-white">
            V
          </div>
          <span className="text-lg font-semibold text-white">
            VidSnap
          </span>
        </div>
        <nav className="flex items-center gap-6 text-sm text-[#a0a0b0]">
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-white"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
