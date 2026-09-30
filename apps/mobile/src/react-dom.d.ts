// The one piece of react-dom the web build uses (TipLayer.web.tsx); its full types aren't installed.
declare module "react-dom" {
  import type { ReactNode, ReactPortal } from "react";
  export function createPortal(
    children: ReactNode,
    container: Element | DocumentFragment,
  ): ReactPortal;
}
