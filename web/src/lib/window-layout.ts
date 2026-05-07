const MOBILE_BREAKPOINT = 640;
const TASKBAR_BOTTOM_INSET = 8;
const TASKBAR_HEIGHT_MOBILE = 48;
const TASKBAR_HEIGHT_DESKTOP = 56;

export function getTaskbarReservedHeight(viewportWidth: number) {
  return (viewportWidth >= MOBILE_BREAKPOINT ? TASKBAR_HEIGHT_DESKTOP : TASKBAR_HEIGHT_MOBILE) + TASKBAR_BOTTOM_INSET;
}

interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

export function clampWindowRect(rect: WindowRect) {
  const taskbarReservedHeight = getTaskbarReservedHeight(rect.viewportWidth);
  const maxX = Math.max(0, rect.viewportWidth - rect.width);
  const maxY = Math.max(0, rect.viewportHeight - taskbarReservedHeight - rect.height);

  return {
    x: Math.min(Math.max(0, rect.x), maxX),
    y: Math.min(Math.max(0, rect.y), maxY),
    width: rect.width,
    height: rect.height,
  };
}
