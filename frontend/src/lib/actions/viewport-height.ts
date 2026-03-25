export function viewportHeight(node: HTMLElement): any {
  if (typeof window === "undefined" || !window.visualViewport) {
    return () => {};
  }
  const vv = window.visualViewport;
  const update = () => {
    node.style.height = vv.height + "px";
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  // Defer so the drawer is fully mounted and visible
  setTimeout(update, 0);
  return () => {
    vv.removeEventListener("resize", update);
    vv.removeEventListener("scroll", update);
  };
}

