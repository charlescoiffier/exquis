/**
 * Copie un texte dans le presse-papiers. L'API moderne n'existe que sur une page sécurisée (HTTPS ou localhost) : sur une
 * adresse du réseau local en HTTP (essai sur smartphone), on retombe sur une copie via un champ temporaire.
 * Renvoie vrai si la copie a réussi.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // refusée : on essaie la méthode de secours
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
  document.body.appendChild(area);
  const previous = document.activeElement as HTMLElement | null;
  try {
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    previous?.focus?.();
  }
}
