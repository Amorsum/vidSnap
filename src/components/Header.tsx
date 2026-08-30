export default function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-[#e5e6eb] bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#165dff] text-sm font-bold text-white">
            V
          </div>
          <span className="text-lg font-semibold text-[#1d2129]">VidSnap</span>
        </div>
        <a
          href="https://github.com/Amorsum/vidSnap"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[#86909c] transition-colors hover:text-[#165dff]"
        >
          GitHub
        </a>
      </div>
    </header>
  );
}
