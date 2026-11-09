import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Essays: one .md file per post in src/content/writing/
const writing = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writing' }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    date: z.coerce.date(),
    // Drafts show up in `npm run dev` but are left out of the built site.
    draft: z.boolean().default(false),
  }),
});

// Projects: one .md file per project in src/content/projects/
const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    // Path to an image in public/, e.g. "/images/projects/my-project.jpg"
    image: z.string().optional(),
    imageAlt: z.string().optional(),
    // External link (repo, live site). If the file has body text, it also gets its own page.
    url: z.string().optional(),
    // Name of a three.js demo in src/demos/ (without .ts). Gives the project its own page.
    demo: z.string().optional(),
    // Lower numbers show first.
    order: z.number().default(100),
    draft: z.boolean().default(false),
  }),
});

export const collections = { writing, projects };
