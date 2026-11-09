# Zander Schatzberg — personal site

Built with [Astro](https://astro.build). Plain static HTML output.

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # outputs to dist/
```

## Adding content

- **Essay:** add `src/content/writing/my-post.md` with `title`, `subtitle` (optional) and `date` in the front matter. Add `draft: true` to hide it from the live site.
- **Project:** add `src/content/projects/my-project.md` with `title`, `description`, and optionally `image` (a path in `public/`), `url` and `order`. Text below the front matter gives the project its own page.
- **three.js demo:** add `src/demos/my-project.ts` (copy `example-project.ts`: it exports a function that builds the scene in a container and returns a cleanup function), then set `demo: my-project` in the project's front matter. Put models and textures in `public/projects/my-project/` and load them from inside the demo. Each demo is its own bundle and only downloads on that project's page, once it scrolls into view. The `image` is shown as a poster until then.
- **About photo:** save it as `public/images/me.jpg`.
- **Name, email, links:** `src/site.ts`.
- **Home intro and About text:** `src/pages/index.astro` and `src/pages/about.astro`.
- **Colours and fonts:** the top of `src/styles/global.css`.

## Hosting (Railway)

`railway.json` builds with `npm run build` and starts with `npm start`, which serves `dist/` on Railway's `$PORT`. Hashed files in `/_astro/` are cached for a year; demo assets in `/projects/` for a week (see `serve.json`).
