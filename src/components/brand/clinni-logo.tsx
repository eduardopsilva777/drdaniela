import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Marca Clinni — traçados copiados dos arquivos oficiais da identidade visual
 * (vsmidia/, "Logotipo — versões e uso"), sem redesenho. O arco é a jornada; o
 * ponto, a pessoa no centro dela. As cores vêm dos tokens de marca, então a
 * mesma peça funciona nos temas claro (tinta + damasco) e escuro (porcelana +
 * damasco claro). `tone="inverse"` é para a superfície institucional em tinta.
 *
 * Regras de uso: não distorcer, girar ou trocar cores; área de proteção igual à
 * altura do "x"; horizontal ≥ 108 px de largura; abaixo de 24 px de altura,
 * usar `variant="compact"`; símbolo e favicon ≥ 16 px.
 */

type Tone = "auto" | "inverse";

const INK: Record<Tone, string> = { auto: "fill-brand-ink", inverse: "fill-brand-on-surface" };
const DOT: Record<Tone, string> = { auto: "fill-brand-dot", inverse: "fill-brand-dot-light" };

function a11y(title: string | undefined) {
  return title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true as const };
}

/** Símbolo isolado: barra lateral recolhida, avatar, marca-d'água. */
export function ClinniSymbol({ className, title, tone = "auto" }: { className?: string; title?: string; tone?: Tone }) {
  return (
    <svg viewBox="0 0 512 512" className={cn("size-6 shrink-0", className)} {...a11y(title)}>
      <path
        className={INK[tone]}
        d="M287.199 1.908A256 256 0 1 0 511.961 251.532L392.835 253.612A136.855 136.855 0 1 1 272.678 120.165Z"
      />
      <circle className={DOT[tone]} cx="401.974" cy="124.564" r="69.233" />
    </svg>
  );
}

/**
 * Logotipo horizontal (símbolo + nome). `regular` a partir de 24 px de altura
 * (barra lateral, cabeçalhos, documentos); `compact` para alturas menores —
 * traço mais forte e espaçamento mais aberto, desenhados para tamanhos pequenos.
 */
export function ClinniLogo({
  className,
  title = "Clinni",
  tone = "auto",
  variant = "regular",
}: {
  className?: string;
  title?: string;
  tone?: Tone;
  variant?: "regular" | "compact";
}) {
  if (variant === "compact") {
    return (
      <svg viewBox="0 0 331.247 73.62" className={cn("h-5 w-auto shrink-0", className)} {...a11y(title)}>
        <path
          className={INK[tone]}
          d="M38.642 0.05A36.72 36.72 0 1 0 73.39 38.642L53.221 37.585A16.524 16.524 0 1 1 37.585 20.219Z"
        />
        <circle className={DOT[tone]} cx="56.504" cy="18.906" r="11.245" />
        <g className={INK[tone]} transform="translate(99.878 72.72) scale(1)">
          <path d="M42.548 -44.841A25.9 25.9 0 1 0 42.548 -5.159L35.478 -13.586A14.9 14.9 0 1 1 35.478 -36.414Z" />
          <path d="M53.048 -72H64.048V0H53.048Z" />
          <path d="M79.048 -50H90.048V0H79.048Z" />
          <circle cx="84.548" cy="-65.22" r="6.82" />
          <path d="M105.048 0V-50H116.048V-48.366A21 21 0 0 1 147.048 -29.9V0H136.048V-29.9A10 10 0 0 0 116.048 -29.9V0Z" />
          <path d="M162.048 0V-50H173.048V-48.366A21 21 0 0 1 204.048 -29.9V0H193.048V-29.9A10 10 0 0 0 173.048 -29.9V0Z" />
          <path d="M219.048 -50H230.048V0H219.048Z" />
          <circle cx="224.548" cy="-65.22" r="6.82" />
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 643.696 145.8" className={cn("h-7 w-auto shrink-0", className)} {...a11y(title)}>
      <path
        className={INK[tone]}
        d="M80.775 0.537A72 72 0 1 0 143.989 70.743L110.485 71.328A38.491 38.491 0 1 1 76.691 33.796Z"
      />
      <circle className={DOT[tone]} cx="113.055" cy="35.034" r="19.472" />
      <g className={INK[tone]} transform="translate(201.6 144) scale(2)">
        <path d="M42.548 -44.841A25.9 25.9 0 1 0 42.548 -5.159L36.12 -12.82A15.9 15.9 0 1 1 36.12 -37.18Z" />
        <path d="M52.048 -72H62.048V0H52.048Z" />
        <path d="M76.048 -50H86.048V0H76.048Z" />
        <circle cx="81.048" cy="-63.6" r="6" />
        <path d="M100.048 0V-50H110.048V-48.007A20.5 20.5 0 0 1 141.048 -30.4V0H131.048V-30.4A10.5 10.5 0 0 0 110.048 -30.4V0Z" />
        <path d="M155.048 0V-50H165.048V-48.007A20.5 20.5 0 0 1 196.048 -30.4V0H186.048V-30.4A10.5 10.5 0 0 0 165.048 -30.4V0Z" />
        <path d="M210.048 -50H220.048V0H210.048Z" />
        <circle cx="215.048" cy="-63.6" r="6" />
      </g>
    </svg>
  );
}

/**
 * Identificação da clínica (espaço de trabalho): iniciais sobre a superfície em
 * tinta. Até existir o logotipo próprio de cada clínica (etapa multi-clínica),
 * é o que distingue a clínica ativa da marca do produto.
 */
export function ClinicMark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-surface text-[0.6875rem] font-bold tracking-wide text-brand-on-surface",
        className,
      )}
    >
      {initials(name) || "?"}
    </span>
  );
}
