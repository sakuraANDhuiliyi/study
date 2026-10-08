import { useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
export function ResizableWorkspace({ children }: { children: [ReactNode, ReactNode] }) {
  const [width, setWidth] = useState(44);
  const container = useRef<HTMLDivElement>(null);
  const clamp = (value: number) => Math.max(30, Math.min(65, value));
  return (
    <div
      ref={container}
      className="algo-workspace algo-resizable"
      style={{ '--algo-reading-width': `${width}%` } as CSSProperties}
    >
      {children[0]}
      <div
        className="algo-splitter"
        role="separator"
        aria-label="调整题目与代码区域宽度"
        aria-orientation="vertical"
        aria-valuemin={30}
        aria-valuemax={65}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const bounds = container.current?.getBoundingClientRect();
          if (bounds) setWidth(clamp(Math.round(((event.clientX - bounds.left) / bounds.width) * 100)));
        }}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            setWidth(clamp(width + (event.key === 'ArrowLeft' ? -2 : 2)));
          }
        }}
      >
        <span />
      </div>
      {children[1]}
    </div>
  );
}
