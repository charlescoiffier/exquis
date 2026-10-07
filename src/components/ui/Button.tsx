import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary";
const cls = (variant: Variant, extra?: string) => `btn${variant === "secondary" ? " secondary" : ""}${extra ? ` ${extra}` : ""}`;

/** Bouton : primaire (moutarde, ombre dure) ou secondaire (transparent, bordure). Une seule action primaire par écran. */
export function Button({ variant = "primary", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" {...rest} className={cls(variant, className)} />;
}

/** Lien présenté comme un bouton. */
export function ButtonLink({ href, variant = "primary", children, className }: { href: string; variant?: Variant; children: ReactNode; className?: string }) {
  return <Link href={href} className={cls(variant, className)}>{children}</Link>;
}
