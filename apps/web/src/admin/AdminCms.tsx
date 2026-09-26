import { useEffect, useState } from "react";
import { get, put } from "../lib/api";
import { Pill, statusKind } from "../components/ui";
import type { ToastFn } from "./AdminLayout";

export function AdminCms({ onToast }: { onToast: ToastFn }) {
  const [tab, setTab] = useState<"pages" | "banners" | "announcements">("pages");
  const [pages, setPages] = useState<{ slug: string; title: string; status: string; updatedAt: string; content: string }[]>([]);
  const [banners, setBanners] = useState<{ id: string; title: string; imageUrl: string; isActive: boolean; position: string }[]>([]);
  const [announcements, setAnnouncements] = useState<{ id: string; title: string; body: string; type: string; isActive: boolean; createdAt: string }[]>([]);
  const [editing, setEditing] = useState<{ slug: string; title: string; content: string; status: string } | null>(null);

  const load = () => {
    if (tab === "pages") get<{ pages: typeof pages }>("/api/admin/cms/pages").then((r) => setPages(r.pages)).catch(() => undefined);
    if (tab === "banners") get<{ banners: typeof banners }>("/api/admin/cms/banners").then((r) => setBanners(r.banners)).catch(() => undefined);
    if (tab === "announcements") get<{ announcements: typeof announcements }>("/api/admin/cms/announcements").then((r) => setAnnouncements(r.announcements)).catch(() => undefined);
  };

  useEffect(load, [tab]);

  const savePage = async () => {
    if (!editing) return;
    try {
      await put(`/api/admin/cms/pages/${editing.slug}`, editing);
      onToast({ message: "Sayfa kaydedildi", kind: "success" });
      setEditing(null);
      load();
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Kaydedilemedi", kind: "error" });
    }
  };

  return (
    <div className="page">
      <h1 className="section-title" style={{ marginTop: 0 }}>Icerik Yonetimi</h1>

      <div className="row mb" style={{ gap: 6 }}>
        {(["pages", "banners", "announcements"] as const).map((key) => (
          <button key={key} className={`btn btn-sm ${tab === key ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab(key)}>
            {key === "pages" ? "Sayfalar" : key === "banners" ? "Bannerlar" : "Duyurular"}
          </button>
        ))}
      </div>

      {tab === "pages" && (
        <div className="card">
          <table className="table">
            <thead><tr><th>Slug</th><th>Baslik</th><th>Durum</th><th>Guncelleme</th><th></th></tr></thead>
            <tbody>
              {pages.map((page) => (
                <tr key={page.slug}>
                  <td className="mono small">{page.slug}</td>
                  <td>{page.title}</td>
                  <td><Pill kind={statusKind(page.status)}>{page.status}</Pill></td>
                  <td className="tiny faint">{new Date(page.updatedAt).toLocaleDateString("tr-TR")}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => setEditing({ slug: page.slug, title: page.title, content: page.content, status: page.status })}>Duzenle</button></td>
                </tr>
              ))}
            </tbody>
          </table>

          {editing && (
            <div className="mt">
              <div className="field">
                <label>Baslik</label>
                <input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </div>
              <div className="field">
                <label>Icerik (HTML)</label>
                <textarea className="textarea" style={{ minHeight: 220 }} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <select className="select" style={{ width: 180 }} value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                  <option value="DRAFT">Taslak</option>
                  <option value="PUBLISHED">Yayinda</option>
                  <option value="ARCHIVED">Arsiv</option>
                </select>
                <button className="btn btn-primary" onClick={savePage}>Kaydet</button>
                <button className="btn btn-ghost" onClick={() => setEditing(null)}>Iptal</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "banners" && (
        <div className="grid grid-2">
          {banners.map((banner) => (
            <div className="card" key={banner.id}>
              <div className="bold mb">{banner.title}</div>
              <div className="tiny faint mono mb">{banner.imageUrl}</div>
              <div className="row" style={{ gap: 6 }}>
                <Pill kind="info">{banner.position}</Pill>
                <Pill kind={banner.isActive ? "success" : "neutral"}>{banner.isActive ? "Aktif" : "Pasif"}</Pill>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "announcements" && (
        <div className="col" style={{ gap: 12 }}>
          {announcements.map((announcement) => (
            <div className="card" key={announcement.id}>
              <div className="row-between mb">
                <div className="bold">{announcement.title}</div>
                <Pill kind={statusKind(announcement.isActive ? "ACTIVE" : "CANCELLED")}>{announcement.type}</Pill>
              </div>
              <p className="small muted">{announcement.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

