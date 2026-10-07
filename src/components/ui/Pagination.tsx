import Link from "next/link";

/**
 * Navigation « Précédent / Suivant » d'une liste paginée. Le numéro de page est porté par le paramètre d'URL `param`
 * (plusieurs listes peuvent coexister sur la même page) ; les autres paramètres sont conservés.
 */
export function Pagination({
  page,
  pageCount,
  param,
  basePath,
  searchParams,
  label,
}: {
  page: number;
  pageCount: number;
  param: string;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  label: string;
}) {
  if (pageCount <= 1) return null;
  const href = (target: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (k === param || v === undefined) continue;
      for (const x of Array.isArray(v) ? v : [v]) q.append(k, x);
    }
    if (target > 1) q.set(param, String(target));
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return (
    <nav className="pagination" aria-label={`Pagination : ${label}`}>
      {page > 1 ? <Link href={href(page - 1)} rel="prev" className="btn secondary">Précédent</Link> : <span className="btn secondary disabled" aria-disabled="true">Précédent</span>}
      <span className="pagination-count" aria-current="page">Page {page} sur {pageCount}</span>
      {page < pageCount ? <Link href={href(page + 1)} rel="next" className="btn secondary">Suivant</Link> : <span className="btn secondary disabled" aria-disabled="true">Suivant</span>}
    </nav>
  );
}
