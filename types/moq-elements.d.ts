import type React from "react";

type MoqElementProps = React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLElement>,
  HTMLElement
> & {
  url?: string;
  name?: string;
  source?: "camera" | "screen" | "file";
  muted?: boolean;
  invisible?: boolean;
  preview?: "none" | "source" | "encoded";
  announce?: "always" | "source" | "never";
  paused?: boolean;
  volume?: number | string;
  visible?: "never" | "always" | string;
  reload?: boolean;
  latency?: number | string;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "moq-publish": MoqElementProps;
      "moq-watch": MoqElementProps;
    }
  }
}
