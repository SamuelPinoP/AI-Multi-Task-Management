import { BRAND_TEAL, LOGO_LETTERS_PATH, LOGO_SPARK_PATH, LOGO_STROKE_WIDTH } from "@/lib/brand";

/**
 * The AI Multi mark (DES-07). It's decorative: put the name next to it as text,
 * so screen readers hear "AI Multi" once.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" className={className}>
      <rect width="48" height="48" rx="12" fill={BRAND_TEAL} />
      <path
        d={LOGO_LETTERS_PATH}
        fill="none"
        stroke="#ffffff"
        strokeWidth={LOGO_STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d={LOGO_SPARK_PATH} fill="#ffffff" />
    </svg>
  );
}
