interface ResultPanelProps {
  video: {
    id: string;
    title: string;
    duration: number;
    thumbnail: string;
    uploader: string;
  };
  result: {
    overall: string;
    videoType?: string;
    segments: { title: string; start: number; end: number; points: { time: string; text: string }[] }[];
  };
  transcriptSource: "builtin" | "whisper";
  followUpAnswer?: string;
  followUpLoading?: boolean;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function ResultPanel({
  video,
  result,
  transcriptSource,
  followUpAnswer,
  followUpLoading,
}: ResultPanelProps) {
  const answer = result as {
    overall: string;
    videoType?: string;
    segments: { title: string; start: number; end: number; points: { time: string; text: string }[] }[];
  };

  return (
    <div className="w-full max-w-2xl space-y-6">
      {/* 视频信息卡片 */}
      <div className="flex gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
        <img
          src={video.thumbnail}
          alt={video.title}
          className="h-24 w-40 flex-shrink-0 rounded-xl object-cover"
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-white">
            {video.title}
          </h2>
          <div className="mt-1 flex items-center gap-3 text-xs text-[#a0a0b0]">
            <span>{video.uploader}</span>
            <span className="h-3 w-px bg-white/20" />
            <span>{formatDuration(video.duration)}</span>
            <span className="h-3 w-px bg-white/20" />
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${transcriptSource === "builtin" ? "bg-[#00cec9]/10 text-[#00cec9]" : "bg-[#6c5ce7]/10 text-[#6c5ce7]"}`}>
              {transcriptSource === "builtin" ? "自带字幕" : "AI 识别"}
            </span>
          </div>
        </div>
      </div>

      {/* AI 结果 */}
      <div className="rounded-2xl border border-[#6c5ce7]/20 bg-[#6c5ce7]/5 p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <h3 className="text-sm font-medium text-white">AI 总结</h3>
          {answer.videoType && (
            <span className="rounded-full bg-[#6c5ce7]/20 px-2 py-0.5 text-[10px] text-[#a29bfe]">
              {answer.videoType}
            </span>
          )}
        </div>

        {/* 一句话总结 */}
        <div className="mb-6 rounded-xl border border-white/5 bg-white/5 px-4 py-3">
          <p className="text-sm text-[#a0a0b0]">💡 一句话总结</p>
          <p className="mt-1 text-sm text-white">{answer.overall}</p>
        </div>

        {/* 分段详情 */}
        {answer.segments && answer.segments.length > 0 && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-[#a0a0b0]">📍 视频分段</p>
            {answer.segments.map((seg, i) => (
              <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-medium text-white">{seg.title}</h4>
                  <span className="text-xs text-[#666]">
                    {formatDuration(seg.start)} - {formatDuration(seg.end)}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {seg.points.map((point, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm text-[#ccc]">
                      <span className="mt-0.5 flex-shrink-0 rounded bg-[#6c5ce7]/20 px-1.5 py-0.5 font-mono text-[10px] text-[#a29bfe]">
                        {point.time}
                      </span>
                      <span>{point.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 追问答案 */}
      {(followUpAnswer || followUpLoading) && (
        <div className="rounded-2xl border border-[#00cec9]/20 bg-[#00cec9]/5 p-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-lg">💬</span>
            <h3 className="text-sm font-medium text-white">追问回答</h3>
          </div>
          {followUpLoading ? (
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#00cec9] border-t-transparent" />
              <span className="text-sm text-[#a0a0b0]">思考中...</span>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-[#ccc]">{followUpAnswer}</p>
          )}
        </div>
      )}
    </div>
  );
}