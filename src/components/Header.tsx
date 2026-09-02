import Image from "next/image";
import Icon from "./Icon";

export default function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-white/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <a href="#top" className="group flex items-center gap-2.5" aria-label="VidSnap 首页">
          <Image
            src="/vidsnap-mark.svg"
            alt=""
            width={36}
            height={36}
            priority
            className="brand-shadow h-9 w-9 rounded-xl transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105"
          />
          <div>
            <span className="block text-[17px] font-bold tracking-[-0.02em] text-ink">VidSnap</span>
            <span className="hidden text-[9px] font-medium uppercase tracking-[0.18em] text-faint sm:block">Video intelligence</span>
          </div>
        </a>
        <a
          href="https://github.com/Amorsum/vidSnap"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-full border border-line bg-white/80 px-3.5 py-2 text-xs font-medium text-muted shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:text-brand hover:shadow-md"
        >
          <Icon name="github" size={15} />
          GitHub
          <Icon name="external-link" size={12} />
        </a>
      </div>
    </header>
  );
}
