import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://schatzberg.xyz',
  markdown: {
    shikiConfig: {
      themes: { light: 'min-light', dark: 'min-dark' },
      defaultColor: false,
    },
  },
});
