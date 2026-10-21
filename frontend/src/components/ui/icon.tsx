type IconProps = {
  src: string;
  className?: string;
};

/**
 * Ikon 1-warna dari Figma. Memakai <img> biasa (bukan next/image) agar SVG
 * memakai <img> biasa (bukan next/image) agar SVG
 * dirender apa adanya tanpa lewat optimizer; ukuran diatur lewat class.
 * `tone="invert"` dipakai untuk ikon di atas latar gelap (lingkaran merek).
 */
export function Icon({
  src,
  className = "size-4",
  tone = "default",
}: IconProps & { tone?: "default" | "invert" }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/figma/${src}`}
      alt=""
      aria-hidden
      className={`shrink-0 object-contain ${className} ${
        tone === "invert" ? "brightness-0 invert" : ""
      }`}
    />
  );
}
