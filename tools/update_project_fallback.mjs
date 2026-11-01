/** Keep the native HTML fallback in sync with the single project data source.
 * Run after editing scripts/projects.js: node tools/update_project_fallback.mjs
 * No dependencies, network access, or publication.
 */
import { readFile, writeFile } from "node:fs/promises";
import { projects } from "../scripts/projects.js";
const path = new URL("../index.html", import.meta.url);
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const details = projects
  .map(
    (project) => `
            <details>
              <summary>${escape(project.title)}</summary>
              <p class="fallback-category">${escape(project.category)} · FICHA DE EJEMPLO</p>
              <p>${escape(project.description)}</p>
            </details>`,
  )
  .join("\n");
const html = await readFile(path, "utf8");
const marker =
  /<!-- PROJECT_FALLBACK:start -->[\s\S]*?<!-- PROJECT_FALLBACK:end -->/;
if (!marker.test(html))
  throw new Error("Native project fallback markers not found.");
await writeFile(
  path,
  html.replace(
    marker,
    "<!-- PROJECT_FALLBACK:start -->\n" +
      details +
      "\n            <!-- PROJECT_FALLBACK:end -->",
  ),
);
