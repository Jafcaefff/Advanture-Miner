import React from "react";

export function PixelHero({ tint = "#ffd27a" }: { tint?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="100%" height="100%" shapeRendering="crispEdges">
      <rect x="0" y="0" width="16" height="16" fill="transparent" />
      <rect x="6" y="1" width="4" height="4" fill={tint} />
      <rect x="5" y="5" width="6" height="5" fill={tint} />
      <rect x="4" y="6" width="2" height="2" fill={tint} />
      <rect x="10" y="6" width="2" height="2" fill={tint} />
      <rect x="6" y="10" width="2" height="4" fill={tint} />
      <rect x="8" y="10" width="2" height="4" fill={tint} />
      <rect x="5" y="14" width="2" height="1" fill={tint} />
      <rect x="9" y="14" width="2" height="1" fill={tint} />
      <rect x="6" y="2" width="1" height="1" fill="#2a1a0a" opacity="0.65" />
      <rect x="9" y="2" width="1" height="1" fill="#2a1a0a" opacity="0.65" />
    </svg>
  );
}

export function PixelGolem({ tint = "#b9b3aa" }: { tint?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="100%" height="100%" shapeRendering="crispEdges">
      <rect x="0" y="0" width="16" height="16" fill="transparent" />
      <rect x="4" y="2" width="8" height="6" fill={tint} />
      <rect x="3" y="4" width="2" height="4" fill={tint} />
      <rect x="11" y="4" width="2" height="4" fill={tint} />
      <rect x="5" y="8" width="6" height="5" fill={tint} />
      <rect x="6" y="13" width="2" height="2" fill={tint} />
      <rect x="8" y="13" width="2" height="2" fill={tint} />
      <rect x="6" y="4" width="1" height="1" fill="#2a1a0a" opacity="0.7" />
      <rect x="9" y="4" width="1" height="1" fill="#2a1a0a" opacity="0.7" />
    </svg>
  );
}

