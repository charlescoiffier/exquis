/** Motifs de signalement proposés (partagés entre l'interface et le serveur). */
export const REPORT_REASONS = [
  { id: "inappropriate", label: "Contenu inapproprié" },
  { id: "harassment", label: "Harcèlement ou insultes" },
  { id: "spam", label: "Publicité ou spam" },
  { id: "other", label: "Autre" },
] as const;

export const reasonLabel = (id: string): string => REPORT_REASONS.find((r) => r.id === id)?.label ?? id;
