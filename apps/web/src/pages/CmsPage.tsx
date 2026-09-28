import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get } from "../lib/api";
import { Empty, Spinner } from "../components/ui";
import { IconChevronLeft } from "../components/icons";

interface CmsPageData {
  slug: string;
  title: string;
  content: string;
  locale: string;
  publishedAt: string | null;
}

/**
 * Renders a published CMS page (footer/legal links).
 *
 * Content is authored in the admin panel and arrives as HTML. It is converted
 * to plain text instead of being injected, so nothing typed into the CMS editor
 * can execute in a player's session.
 */
export function CmsPage() {
  const { slug = "" } = useParams();
  const [page, setPage] = useState<CmsPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    get<{ page: CmsPageData }>(`/api/cms/pages/${encodeURIComponent(slug)}`)
      .then((result) => setPage(result.page))
      .catch(() => setError("Sayfa bulunamadi"))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <div className="page page-narrow"><Spinner /></div>;

  if (error || !page) {
    return (
      <div className="page page-narrow">
        <Empty icon="📄" title="Sayfa bulunamadi" hint="Bu icerik yayindan kaldirilmis olabilir." />
      </div>
    );
  }

  const paragraphs = htmlToText(page.content, page.title)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <div className="page page-narrow">
      <Link to="/" className="btn btn-ghost btn-sm mb">
        <IconChevronLeft size={14} /> Geri
      </Link>
      <h1 className="section-title" style={{ marginTop: 0 }}>{page.title}</h1>
      <div className="card">
        {paragraphs.map((block, index) => (
          <p key={index} className="small muted" style={{ lineHeight: 1.7, whiteSpace: "pre-line" }}>
            {block}
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * Flattens admin-authored HTML into readable text. Rendering happens through
 * React text nodes only, so markup from the CMS is never interpreted.
 *
 * The leading heading is dropped when it repeats the page title, which the
 * page already renders — otherwise every legal page opens with its own name
 * twice.
 */
function htmlToText(html: string, title: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  // Block elements become paragraph breaks so list items stay on their own line.
  document
    .querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6, tr")
    .forEach((node) => node.append(document.createTextNode("\n\n")));

  const blocks = (document.body.textContent ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .split(/\n{2,}/);
  while (blocks.length > 0 && blocks[0].trim().localeCompare(title.trim(), "tr", { sensitivity: "base" }) === 0) {
    blocks.shift();
  }
  return blocks.join("\n\n");
}
