import type { SVGProps } from "react";

export type IconName =
  | "arrow-right"
  | "bolt"
  | "captions"
  | "check"
  | "chevron-right"
  | "clock"
  | "external-link"
  | "film"
  | "github"
  | "image"
  | "link"
  | "lock"
  | "message"
  | "play"
  | "search"
  | "send"
  | "sparkles"
  | "wand";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export default function Icon({ name, size = 20, ...props }: IconProps) {
  const paths: Record<IconName, React.ReactNode> = {
    "arrow-right": <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    bolt: <path d="m13 2-9 12h8l-1 8 9-12h-8l1-8Z" />,
    captions: <><rect width="20" height="14" x="2" y="5" rx="2" /><path d="M7 15h4M15 15h2M7 11h2M13 11h4" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    "chevron-right": <path d="m9 18 6-6-6-6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    "external-link": <><path d="M15 3h6v6" /><path d="m10 14 11-11" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
    film: <><rect width="20" height="16" x="2" y="4" rx="2" /><path d="M7 4v16M17 4v16M2 9h5M17 9h5M2 15h5M17 15h5" /></>,
    github: <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.4 4 5 5 0 0 0 19.3.5S18.2.1 15 1.8a13.4 13.4 0 0 0-6 0C5.8.1 4.7.5 4.7.5A5 5 0 0 0 4.6 4a5.4 5.4 0 0 0-1.4 3.7c0 5.3 3.5 6.5 6.8 6.9A4.8 4.8 0 0 0 9 18v4m0-3c-5 1.5-5-2.5-7-3" />,
    image: <><rect width="20" height="18" x="2" y="3" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1" /><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1" /></>,
    lock: <><rect width="18" height="12" x="3" y="10" rx="2" /><path d="M7 10V7a5 5 0 0 1 10 0v3" /></>,
    message: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />,
    play: <path d="m9 7 8 5-8 5V7Z" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
    sparkles: <><path d="m12 3-1.4 3.6L7 8l3.6 1.4L12 13l1.4-3.6L17 8l-3.6-1.4Z" /><path d="m5 14-.9 2.1L2 17l2.1.9L5 20l.9-2.1L8 17l-2.1-.9Z" /><path d="m19 14-.7 1.3L17 16l1.3.7L19 18l.7-1.3L21 16l-1.3-.7Z" /></>,
    wand: <><path d="m15 4 5 5L8 21l-5-5Z" /><path d="m6 14 4 4M17 2v3M22 7h-3M5 2v2M2 5h2" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
