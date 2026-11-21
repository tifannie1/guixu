export const edges = { top: '上边缘', left: '左边缘', right: '右边缘', bottom: '下边缘' };
const inset = 6;
const gripLength = 48;
const gripDepth = 18;
const gripInset = 2;
const sensorDepth = 5;
const panel = { width: 432, height: 592 };
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
const horizontal = side => side === 'top' || side === 'bottom';

export function ratioFor(area, side, point) {
  return horizontal(side) ? clamp((point.x - area.x) / area.width, 0, 1) :
    clamp((point.y - area.y) / area.height, 0, 1);
}

export function nearestEdge(area, point, threshold = 36) {
  const distances = Object.entries({
    top: Math.abs(point.y - area.y),
    left: Math.abs(point.x - area.x),
    right: Math.abs(point.x - area.x - area.width + 1),
    bottom: Math.abs(point.y - area.y - area.height + 1),
  });
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][1] <= threshold ? distances[0][0] : null;
}

export function edgeBounds(area, side, ratio, tab = false) {
  const depth = tab ? gripDepth : sensorDepth;
  let width = horizontal(side) ? area.width : depth;
  let height = horizontal(side) ? depth : area.height;
  let { x, y } = area;
  if (tab && horizontal(side)) {
    width = gripLength;
    x += Math.round(clamp(area.width * ratio - width / 2, 0, area.width - width));
  }
  if (tab && !horizontal(side)) {
    height = gripLength;
    y += Math.round(clamp(area.height * ratio - height / 2, 0, area.height - height));
  }
  if (side === 'right') x += area.width - width;
  if (side === 'bottom') y += area.height - height;
  if (tab) {
    if (side === 'top') y += gripInset;
    if (side === 'bottom') y -= gripInset;
    if (side === 'left') x += gripInset;
    if (side === 'right') x -= gripInset;
  }
  return { x, y, width, height };
}

export function panelBounds(area, side, ratio) {
  const edgeInset = gripDepth + gripInset + 2;
  const left = area.x + (side === 'left' ? edgeInset : inset);
  const right = area.x + area.width - (side === 'right' ? edgeInset : inset);
  const top = area.y + (side === 'top' ? edgeInset : inset);
  const bottom = area.y + area.height - (side === 'bottom' ? edgeInset : inset);
  const width = Math.min(panel.width, right - left);
  const height = Math.min(panel.height, bottom - top);
  const x = horizontal(side) ? area.x + area.width * ratio - width / 2 : side === 'left' ? left : right - width;
  const y = horizontal(side) ? side === 'top' ? top : bottom - height : area.y + area.height * ratio - height / 2;
  return {
    x: Math.round(clamp(x, left, right - width)),
    y: Math.round(clamp(y, top, bottom - height)),
    width, height,
  };
}
