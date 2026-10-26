"use client";

import { useEffect, useState, useCallback } from "react";
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
  // ─── 访问码门禁 ───
  const [mounted, setMounted] = useState(false);
  const [gatePassed, setGatePassed] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [gateError, setGateError] = useState("");
  const [gateChecking, setGateChecking] = useState(false);

  // 等待校验响应落下会话 cookie 后再开放提交，避免首个处理请求与身份签发竞态。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = localStorage.getItem("vidsnap_access_code") || "";
      const urlCode = new URLSearchParams(window.location.search).get("code") || "";
      const candidate = stored || urlCode;
      {
        setAccessCode(candidate);
        setGateChecking(true);
        if (urlCode) {
          localStorage.setItem("vidsnap_access_code", urlCode);
          history.replaceState({}, "", window.location.pathname); // 清除 URL 中的码
        }
        fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: candidate }),
        })
          .then((response) => (response.status === 401 ? { invalid: true } : response.json()))
          .then((data) => {
            // 仅在确认访问码失效时退回门禁（429 等暂时性失败不影响已放行的用户）
            if (data?.invalid) {
              localStorage.removeItem("vidsnap_access_code");
              setAccessCode("");
              setGatePassed(false);
            } else {
              setGatePassed(true);
            }
          })
          .catch(() => { setGatePassed(true); })
          .finally(() => { setGateChecking(false); });
      }
      setMounted(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const handleGateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = accessCode.trim();
    if (!code || gateChecking) return;
    setGateChecking(true);
    setGateError("");
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem("vidsnap_access_code", code);
        setGatePassed(true);
      } else {
        setGateError(data.error || "访问码错误");
      }
    } catch {
      setGateError("网络请求失败，请稍后重试");
    } finally {
      setGateChecking(false);
    }
  };

  const handleUnauthorized = useCallback(() => {
    localStorage.removeItem("vidsnap_access_code");
    setAccessCode("");
    setGatePassed(false);
  }, []);

  return (
    <div id="top" className="page-glow relative flex min-h-screen flex-col overflow-x-clip">
      <div className="dot-grid pointer-events-none absolute inset-x-0 top-16 h-[560px] opacity-40" />
      <Header />

      {!mounted ? null : !gatePassed ? (
        <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
          <div className="surface-shadow grid w-full max-w-4xl overflow-hidden rounded-[28px] border border-white/80 bg-white lg:grid-cols-[1.08fr_0.92fr]">
            <div className="relative hidden min-h-[480px] overflow-hidden bg-[#181a2a] p-10 text-white lg:flex lg:flex-col lg:justify-between">
              <div className="dot-grid absolute inset-0 opacity-30" />
              <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/30 blur-3xl" />
              <div className="relative">
                <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-[#beb9ff] ring-1 ring-white/10">
                  <Icon name="sparkles" size={23} />
                </div>
                <h1 className="max-w-sm text-3xl font-semibold leading-tight tracking-[-0.04em]">少看一会儿视频，<br />多得一些答案。</h1>
                <p className="mt-4 max-w-sm text-sm leading-7 text-white/55">VidSnap 会同时理解字幕与画面，将一段视频转换为可快速阅读、随时追问的内容工作台。</p>
              </div>
              <div className="relative grid grid-cols-3 gap-3">
                {[
                  ["01", "字幕 + 画面"],
                  ["02", "时间节点"],
                  ["03", "Agent 追问"],
                ].map(([index, label]) => (
                  <div key={index} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <span className="font-mono text-[10px] text-[#9f98ff]">{index}</span>
                    <p className="mt-1 text-[11px] text-white/60">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={handleGateSubmit} className="flex min-h-[440px] flex-col justify-center p-7 sm:p-10 lg:p-12">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                <Icon name="lock" size={20} />
              </div>
              <p className="mt-7 text-xs font-semibold uppercase tracking-[0.16em] text-brand">内部演示</p>
              <h1 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-ink">输入访问码</h1>
              <p className="mt-2 text-sm leading-6 text-muted">这是 VidSnap 的演示环境，请使用站长提供的访问码继续。</p>
              <label htmlFor="access-code" className="mt-7 text-xs font-semibold text-muted">访问码</label>
              <input
                id="access-code"
                type="password"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="请输入访问码"
                autoFocus
                aria-describedby={gateError ? "gate-error" : undefined}
                className="mt-2 w-full rounded-xl border border-line bg-surface-soft/60 px-4 py-3 text-sm text-ink outline-none transition-all placeholder:text-faint focus:border-brand/50 focus:bg-white focus:ring-4 focus:ring-brand/10"
              />
              {gateError && <p id="gate-error" className="mt-2 text-xs text-red-500" role="alert">{gateError}</p>}
              <button
                type="submit"
                disabled={gateChecking || !accessCode.trim()}
                className="brand-shadow mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-brand-strong disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-[#b8b4ea] disabled:shadow-none"
              >
                {gateChecking ? "正在验证..." : <>进入 VidSnap <Icon name="arrow-right" size={16} /></>}
              </button>
              <p className="mt-5 text-center text-[11px] text-faint">访问码仅保存在当前浏览器</p>
            </form>
          </div>
        </main>
      ) : (
        <LearningWorkspace accessCode={accessCode} onUnauthorized={handleUnauthorized}>
          <LandingPreview />
        </LearningWorkspace>
      )}

      <Footer />
    </div>
  );
}
