import { one, many } from "./dom.js";
import { projects } from "./projects.js";

export function createProjectDialog(onChange) {
  let selectedProject = 0,
    previousFocus = null;
  function openProject(i) {
    selectedProject = i;
    if (one("#projectModal").hidden) previousFocus = document.activeElement;
    const p = projects[i];
    one("#projectTitle").textContent = p.title;
    one("#projectCategory").textContent = p.category.toUpperCase();
    one("#projectDescription").textContent = p.description;
    one("#projectRef").textContent =
      "FICHA DE ARCHIVO / " +
      String(i + 1).padStart(3, "0") +
      " — " +
      String(projects.length).padStart(3, "0");
    one("#projectArtNo").textContent = String(i + 1).padStart(3, "0");
    one("#projectWord").textContent = p.word;
    one("#projectArtwork").style.setProperty("--project-color", p.color);
    const modal = one("#projectModal");
    modal.hidden = false;
    many("#siteFrame > header, #siteFrame > main, #siteFrame > footer").forEach(
      (node) => (node.inert = true),
    );
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    one("#closeProject").focus();
    onChange();
  }
  function closeProject(restore = true) {
    const modal = one("#projectModal");
    if (modal.hidden) return;
    modal.hidden = true;
    many("#siteFrame > header, #siteFrame > main, #siteFrame > footer").forEach(
      (node) => (node.inert = false),
    );
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (
      restore &&
      previousFocus &&
      previousFocus.isConnected &&
      !previousFocus.disabled
    )
      previousFocus.focus();
    onChange();
  }

  one("#closeProject").addEventListener("click", () => closeProject());
  one("#nextProject").addEventListener("click", () =>
    openProject((selectedProject + 1) % projects.length),
  );
  one("#projectModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeProject();
  });
  return {
    open: openProject,
    close: closeProject,
    get isOpen() {
      return !one("#projectModal").hidden;
    },
    trapFocus(event) {
      if (event.key !== "Tab" || !this.isOpen) return;
      const items = many("#projectModal button:not([disabled])");
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items.at(-1).focus();
      }
      if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault();
        items[0].focus();
      }
    },
  };
}
