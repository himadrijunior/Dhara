"use client";

import { useId } from "react";

/**
 * Dhara brand marks — inline SVG so they follow the app theme via currentColor.
 * Logo: three stacked flow layers (monochrome, from dhara-logo.svg).
 * Loader: the official dhara-loader.svg animation (4s SMIL loop), multi-instance safe.
 */

export function DharaLogo({
  size = 40,
  className = "",
  title = "Dhara",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 380 380"
      width={size}
      height={size}
      role="img"
      aria-label={title}
      className={className}
      style={{ color: "currentColor" }}
    >
      <title>{title}</title>
      <defs>
        <path id="dhara-layer" d="M50 130 C110 215 250 200 330 80 C240 150 120 160 50 100 Q34 115 50 130 Z" />
      </defs>
      <g fill="currentColor" transform="translate(0,-6)">
        <use href="#dhara-layer" />
        <use href="#dhara-layer" transform="translate(0,62)" />
        <use href="#dhara-layer" transform="translate(0,124)" />
      </g>
    </svg>
  );
}

/** Individual layer path — for the landing cascade animation. */
export function DharaLayerPath({ transform }: { transform?: string }) {
  return (
    <path
      transform={transform}
      d="M50 130 C110 215 250 200 330 80 C240 150 120 160 50 100 Q34 115 50 130 Z"
    />
  );
}

export function DharaLoader({
  size = 56,
  className = "",
  label = "Loading",
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const k = (n: number) => `dhk${n}-${uid}`;
  const maskPath = "M40 112 C110 180 250 170 335 70";
  const begins = ["0s", "0.02s", "0.04s"];
  return (
    <svg
      viewBox="0 0 380 380"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={className}
      style={{ color: "currentColor" }}
    >
      <title>{label}</title>
      <defs>
        {[0, 1, 2].map((i) => (
          <mask key={i} id={k(i)} maskUnits="userSpaceOnUse" x="0" y="-40" width="380" height="420">
            <path
              d={maskPath}
              pathLength={1}
              fill="none"
              stroke="#fff"
              strokeWidth={90}
              strokeLinecap="round"
              strokeDasharray="1 2"
              strokeDashoffset={1}
            >
              <animate
                attributeName="stroke-dashoffset"
                dur="4s"
                repeatCount="indefinite"
                values="1;1;0;0"
                keyTimes="0;0.10;0.40;1"
                calcMode="spline"
                keySplines="0 0 1 1;.45 .05 .55 .95;0 0 1 1"
                begin={begins[i]}
              />
            </path>
          </mask>
        ))}
      </defs>
      <g fill="currentColor">
        <animate
          attributeName="opacity"
          dur="4s"
          repeatCount="indefinite"
          values="1;1;0;0"
          keyTimes="0;0.74;0.92;1"
        />
        {[0, 1, 2].map((i) => (
          <g key={i} transform={`translate(0,${-6 + i * 62})`} mask={`url(#${k(i)})`}>
            <path d="M50 130 C110 215 250 200 330 80 C240 150 120 160 50 100 Q34 115 50 130 Z" />
          </g>
        ))}
      </g>
    </svg>
  );
}
