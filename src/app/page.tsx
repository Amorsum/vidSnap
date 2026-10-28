"use client";

import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Icon from "@/components/Icon";
import LearningWorkspace from "@/components/LearningWorkspace";

function LandingPreview() {
  return (
    <section className="animate-rise-in mt-12 w-full max-w-5xl" aria-label="VidSnap 功能预览">
      <div className="surface-shadow overflow-hidden rounded-[28px] border border-white/80 bg-white/75 p-3 backdrop-blur sm:p-4">
        <div className="grid gap-3 lg:grid-cols-[1.45fr_0.75fr]">
          <div className="rounded-[22px] border border-line/80 bg-white p-4 sm:p-5">
            <div className="flex items-center gap-3 border-b border-line/70 pb-4">
              <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-[#262b46] to-[#6964ab]">
                <div className="absolute inset-0 dot-grid opacity-60" />
                <div className="absolute inset-0 flex items-center justify-center text-white">
                  <Icon name="play" size={19} className="fill-current" />
                </div>
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">如何用 AI 重新设计工作流</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                  <Icon name="clock" size={13} /> 18:42 · 已完成视频理解
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl bg-gradient-to-br from-brand-soft to-[#f6f5ff] p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-brand-strong">
                <Icon name="sparkles" size={15} /> 核心结论
              </div>
              <p className="text-sm leading-6 text-[#353552]">将重复任务交给 AI，人的价值会从“执行”转向“定义问题和判断结果”。</p>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {["重新定义问题", "构建 AI 工作流", "保留人的判断"].map((item, index) => (
                <div key={item} className="rounded-xl border border-line/70 px-3 py-3">
                  <span className="font-mono text-[10px] font-semibold text-brand">0{index + 1}</span>
                  <p className="mt-1 text-xs font-medium text-muted">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex min-h-64 flex-col rounded-[22px] bg-[#181a2a] p-4 text-white sm:p-5">
            <div className="flex items-center gap-2 border-b border-white/10 pb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-[#bdb8ff]">
                <Icon name="message" size={16} />
              </div>
              <div>
                <p className="text-xs font-semibold">询问视频 Agent</p>
                <p className="mt-0.5 text-[10px] text-white/45">基于字幕与画面回答</p>
              </div>
              <span className="ml-auto h-2 w-2 rounded-full bg-[#4fd1a9] shadow-[0_0_0_4px_rgba(79,209,169,.12)]" />
            </div>
            <div className="flex flex-1 flex-col justify-center gap-3 py-5">
              <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-brand px-3 py-2 text-xs">视频中最值得实践的建议是什么？</div>
              <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-white/9 px-3 py-2.5 text-xs leading-5 text-white/75">先选择一个每周重复三次以上的流程，再将其中可验证的环节交给 AI。 <span className="text-[#aaa4ff]">[06:18]</span></div>
            </div>
            <div className="flex items-center rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-[11px] text-white/35">继续追问视频内容…<Icon name="send" size={13} className="ml-auto" /></div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { icon: "captions" as const, title: "字幕识别", detail: "自动转写" },
          { icon: "image" as const, title: "画面理解", detail: "关键帧视觉分析" },
          { icon: "message" as const, title: "内容追问", detail: "秒级溯源" },
        ].map((item) => (
          <div key={item.title} className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-white/80 bg-white/55 px-2 py-3 text-center backdrop-blur sm:flex-row sm:justify-start sm:px-4 sm:text-left">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"><Icon name={item.icon} size={15} /></div>
            <div><p className="text-xs font-semibold text-ink">{item.title}</p><p className="mt-0.5 hidden text-[10px] text-faint sm:block">{item.detail}</p></div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <div id="top" className="page-glow relative flex min-h-screen flex-col overflow-x-clip">
      <div className="dot-grid pointer-events-none absolute inset-x-0 top-16 h-[560px] opacity-40" />
      <Header />

      <LearningWorkspace>
        <LandingPreview />
      </LearningWorkspace>

      <Footer />
    </div>
  );
}
