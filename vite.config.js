import { defineConfig } from 'vite';

// Relative base for GitHub Pages — works at username.github.io/RepoName/
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? './' : '/',
});
