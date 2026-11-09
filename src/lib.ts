import { getCollection, type CollectionEntry } from 'astro:content';

const showDrafts = import.meta.env.DEV;

export async function getEssays() {
  const all = await getCollection('writing', ({ data }) => showDrafts || !data.draft);
  return all.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export async function getProjects() {
  const all = await getCollection('projects', ({ data }) => showDrafts || !data.draft);
  return all.sort((a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title));
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
