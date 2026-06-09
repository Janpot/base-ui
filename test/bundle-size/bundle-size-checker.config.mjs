/**
 * @file Configuration file for bundle-size-checker
 *
 * This file determines which packages and components will have their bundle sizes measured.
 */
import path from 'path';
import fs from 'fs/promises';
import { defineConfig } from '@mui/internal-bundle-size-checker';

const rootDir = path.resolve(import.meta.dirname, '../..');

// `@base-ui/utils` can't use `expand` because it relies on a `./*` wildcard export,
// which the checker collects literally rather than globbing against the filesystem.
async function getUtilsExports() {
  // Read top-level files to get utils exports
  const utilsDir = path.join(rootDir, 'packages/utils/src');
  const files = await fs.readdir(utilsDir);

  // Get file stats concurrently
  const fileStats = await Promise.all(
    files.map(async (file) => {
      const filePath = path.join(utilsDir, file);
      const stat = await fs.stat(filePath);
      return { file, stat };
    }),
  );

  const entrypoints = fileStats
    .filter(({ file, stat }) => {
      // For files, only include .ts and .tsx files
      if (stat.isFile() && !(file.endsWith('.ts') || file.endsWith('.tsx'))) {
        return false;
      }
      // Exclude test files
      if (file.includes('.test.')) {
        return false;
      }
      return true;
    })
    .map(({ file }) => `@base-ui/utils/${file.replace(/\.(js|ts|tsx)$/, '')}`);

  return entrypoints;
}

/**
 * Generates the entrypoints configuration by scanning the exports field in package.json.
 */
export default defineConfig(async () => {
  return {
    entrypoints: [
      { id: '@base-ui/react', import: '@base-ui/react', expand: true },
      ...(await getUtilsExports()),
    ],
    upload: !!process.env.CI,
    comment: true,
  };
});
