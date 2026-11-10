import { getCollection, type CollectionEntry } from 'astro:content';

const showDrafts = import.meta.env.DEV;

export async function getEssays() {
  const all = await getCollection('writing', ({ data }) => showDrafts || !data.draft);
  return all.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export async function getProjects() {
  const all = await getCollection('projects', ({ data }) => showDrafts || !data.draft);
  const time = (p: CollectionEntry<'projects'>) => p.data.date?.getTime() ?? -Infinity;
  return all.sort(
    (a, b) => time(b) - time(a) || a.data.order - b.data.order || a.data.title.localeCompare(b.data.title),
  );
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Turns [text](url) in a description into links and escapes everything else.
export function inlineLinks(text: string) {
  return text
    .split(/(\[[^\]]+\]\([^)\s]+\))/)
    .map((part) => {
      const m = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (!m || !/^(https?:\/\/|\/)/.test(m[2])) return escapeHtml(part);
      const external = m[2].startsWith('http');
      return `<a href="${escapeHtml(m[2])}"${external ? ' rel="noopener"' : ''}>${escapeHtml(m[1])}</a>`;
    })
    .join('');
}

// The same text with links reduced to their words, for meta tags.
export function plainText(text: string) {
  return text.replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1');
}

export function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function readingTime(body = '') {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

// A project gets its own page if it has a demo or body text; otherwise it links out.
export function projectHasPage(p: CollectionEntry<'projects'>) {
  return Boolean(p.data.demo || p.body?.trim());
}

export function projectHref(p: CollectionEntry<'projects'>) {
  return projectHasPage(p) ? `/projects/${p.id}/` : p.data.url;
}
