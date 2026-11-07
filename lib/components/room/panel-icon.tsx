import Image from "next/image";

const icons = {
  chat: { width: 26, height: 24, white: true },
  image: { width: 26, height: 22, white: false },
  text: { width: 27, height: 26, white: false },
  sorting: { width: 26, height: 24, white: true },
  check: { width: 16, height: 12, white: true },
  pencil: { width: 16, height: 16, white: true },
  eye: { width: 24, height: 16, white: true },
  zoom: { width: 27, height: 27, white: true },
  drag: { width: 12, height: 20, white: false },
} as const;

export type PanelIconName = keyof typeof icons;

/** Keep exported icon geometry intact; selected states only change its color. */
export function PanelIcon({ name, tone = "black", className = "" }: {
  name: PanelIconName; tone?: "black" | "white" | "foreground"; className?: string;
}) {
  const icon = icons[name];
  const invert = icon.white !== (tone === "white");
  const filter = tone === "foreground" ? (icon.white ? "invert dark:invert-0" : "dark:invert") : invert ? "invert" : "";
  return <Image src={`/interactive-panel/${name}.svg`} alt="" width={icon.width} height={icon.height}
    className={`pointer-events-none shrink-0 ${filter} ${className}`} />;
}
