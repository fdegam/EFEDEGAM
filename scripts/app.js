import { one, many, reduced } from "./dom.js";
import { projects } from "./projects.js";
import { createDrawer } from "./drawers.js";
import { createLens } from "./lens.js";
import { createPlant } from "./plant.js";
import { createRoom } from "./room.js";
import { createProjectDialog } from "./project-dialog.js";

// Archive controller: layout, drawer interaction and navigation.
// Contact recipient pending confirmation from the portfolio owner.
const portfolioContactEmail = "";
const portfolioMailto =
  "mailto:" +
  portfolioContactEmail +
  "?subject=" +
  encodeURIComponent("Hola desde EFEDEGAM") +
  "&body=" +
  encodeURIComponent(
    "¡Hola! He visto tu portfolio EFEDEGAM y quería ponerme en contacto contigo.\n\n",
  );
const routes = {
  home: "#inicio",
  archive: "#archivo",
  about: "#sobre-mi",
  vacio: "#vacio",
};
const routeFromHash = () =>
  Object.keys(routes).find((view) => routes[view] === location.hash) || "home";
function navigate(view, { replace = false, animate = true } = {}) {
  if (navigating || !views[view]) return;
  history[replace ? "replaceState" : "pushState"]({ view }, "", routes[view]);
  switchView(view, animate);
}
const views = {
  home: one("#homeView"),
  archive: one("#homeView"),
  about: one("#aboutView"),
  vacio: one("#voidView"),
};
let activeView = null,
  drawerOpen = false,
  picking = false,
  navigating = false;
const lens = createLens(() => activeView);
let cabinetFocused = false,
  openingTimer = null,
  lockedTimer = null;
const wall = one("#cabinet"),
  cells = one("#cabinetCells");
let hero = null,
  voidDrawer = null,
  plantDrawer = null,
  filmDrawer = null,
  phoneDrawer = null,
  ticketDrawer = null,
  layoutIsSmall = null,
  voidBusy = false,
  voidTimer = null;
let introTimers = [];
let introSequenceActive = false;
let introPlayed = false;
const room = createRoom(
  () => activeView,
  () => {
    navigate("archive", { replace: true, animate: false });
  },
);
const dialog = createProjectDialog(() => {
  clearFan();
  lens.refresh();
});
const plant = createPlant(
  () => plantDrawer,
  () => lens.refresh(),
);
function buildWall() {
  const small = innerWidth < 700;
  if (layoutIsSmall === small && hero) return;
  layoutIsSmall = small;
  const cols = small ? 9 : 15,
    rows = small ? 10 : 9;
  wall.style.setProperty("--cols", String(cols));
  wall.style.setProperty("--rows", String(rows));
  const centerRow = Math.floor(rows / 2),
    centerCol = Math.floor(cols / 2);
  hero = null;
  voidDrawer = null;
  plantDrawer = null;
  filmDrawer = null;
  phoneDrawer = null;
  ticketDrawer = null;
  const fragment = document.createDocumentFragment();
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const isHero = r === centerRow && c === centerCol;
      const isVoid = r === 3 && c === (small ? 7 : 12);
      const isPlant = r === 6 && c === (small ? 2 : 3);
      const storyType =
        r === 1 && c === (small ? 2 : 4)
          ? "film"
          : r === 5 && c === (small ? 7 : 12)
            ? "phone"
            : r === (small ? 1 : 2) && c === (small ? 5 : 10)
              ? "ticket"
              : null;
      const unit = createDrawer(
        {
          index: i,
          col: c,
          row: r,
          heroCell: isHero,
          voidCell: isVoid,
          plantCell: isPlant,
          storyType,
        },
        {
          contactHref: portfolioMailto,
          onDrawerClick: clickDrawer,
          onStoryClick(unit) {
            if (activeView === "archive" && !voidBusy) {
              cancelIntroSequence();
              toggleStoryDrawer(unit);
            }
          },
        },
      );
      if (isHero) hero = unit;
      if (isVoid) voidDrawer = unit;
      if (isPlant) plantDrawer = unit;
      if (storyType === "film") filmDrawer = unit;
      if (storyType === "phone") phoneDrawer = unit;
      if (storyType === "ticket") ticketDrawer = unit;
      fragment.append(unit);
    }
  plant.reset();
  cells.replaceChildren(fragment);
  buildFolders();
  lens.refresh();
}
function buildFolders() {
  const holder = one("#fileStack"),
    touch = one("#touchFileButtons");
  holder.replaceChildren();
  touch.replaceChildren();
  projects.forEach((project, index) => {
    const label = String(index + 1).padStart(2, "0");
    const card = document.createElement("button");
    card.type = "button";
    card.className = "file-tab";
    card.style.setProperty("--index", index);
    card.style.setProperty("--tab-color", project.color);
    card.style.setProperty("--folder-color", project.color);
    card.style.setProperty(
      "--tab-left",
      ["7%", "33%", "58%", "16%", "50%", "65%"][index],
    );
    card.innerHTML = `
      <span class="file-card-head"><span class="file-number"></span><span class="file-name"></span><span class="file-arrow">↗</span></span>
      <span class="file-card-info"><span class="file-edition">EFEDEGAM · ARCHIVO</span><span class="file-card-category"></span><span class="file-card-index"></span></span>`;
    card.querySelector(".file-number").textContent = label;
    card.querySelector(".file-name").textContent = project.title;
    card.querySelector(".file-card-category").textContent = project.category;
    card.querySelector(".file-card-index").textContent = "EXP. / " + label;
    card.setAttribute(
      "aria-label",
      "Abrir carpeta " + label + ": " + project.title,
    );
    card.addEventListener("mouseenter", () => fanCards(index));
    card.addEventListener("focus", () => fanCards(index));
    card.addEventListener("click", (event) => {
      event.stopPropagation();
      pickFolder(index);
    });
    holder.append(card);
    const shortcut = document.createElement("button");
    shortcut.type = "button";
    shortcut.textContent = label + " · " + project.title;
    shortcut.addEventListener("click", () => pickFolder(index));
    touch.append(shortcut);
  });
  holder.addEventListener("pointermove", (event) => {
    if (!drawerOpen || picking || event.pointerType !== "mouse") return;
    const rect = holder.getBoundingClientRect();
    const pos = Math.max(
      0,
      Math.min(
        projects.length - 1,
        ((event.clientY - rect.top) / Math.max(1, rect.height)) *
          (projects.length - 1),
      ),
    );
    sweepCards(pos);
  });
  holder.addEventListener("pointerleave", clearFan);
  holder.addEventListener("focusout", (event) => {
    if (!holder.contains(event.relatedTarget)) clearFan();
  });
}
function setDrawer(open) {
  drawerOpen = Boolean(open);
  if (!hero) return;
  hero.classList.toggle("is-open", drawerOpen);
  const btn = hero.querySelector(".drawer-click");
  btn.setAttribute("aria-expanded", String(drawerOpen));
  btn.setAttribute(
    "aria-label",
    drawerOpen
      ? "Cerrar y alejar el cajón de proyectos"
      : "Acercar y abrir el cajón central de proyectos",
  );
  many("#fileStack .file-tab, #touchFileButtons button").forEach(
    (button) => (button.disabled = !drawerOpen),
  );
  one("#touchFiles").hidden = !drawerOpen;
  if (!drawerOpen) clearFan();
  one("#drawerInstruction").textContent = drawerOpen
    ? "Selecciona una carpeta. Pulsa el frontal para cerrar."
    : "Pulsa el cajón 023 de PROYECTOS para acercarte. El 099 guarda otro secreto.";
  lens.refresh();
  setTimeout(lens.refresh, 1100);
}
function focusCabinet() {
  if (cabinetFocused) return;
  cabinetFocused = true;
  one("#archiveView .archive-stage").classList.add("is-project-zoom");
  wall.classList.add("is-zoomed");
  lens.refresh();
  setTimeout(lens.refresh, 1350);
}
function resetCabinet() {
  clearTimeout(openingTimer);
  setDrawer(false);
  cabinetFocused = false;
  wall.classList.remove("is-zoomed", "is-void-zoom");
  one("#archiveView .archive-stage").classList.remove("is-project-zoom");
  wall.style.removeProperty("transform-origin");
  lens.refresh();
}
function jiggleLocked(unit) {
  unit.classList.remove("is-shaking");
  void unit.offsetWidth;
  unit.classList.add("is-shaking");
  one("#drawerInstruction").textContent =
    "Ese cajón está cerrado con llave. Busca el 023 o el 099.";
  clearTimeout(lockedTimer);
  lockedTimer = setTimeout(() => unit.classList.remove("is-shaking"), 500);
}
function clickDrawer(unit, isHero, isVoid, isPlant, storyType) {
  if (voidBusy) return;
  if (storyType) {
    cancelIntroSequence();
    toggleStoryDrawer(unit);
    return;
  }
  if (isPlant) {
    cancelIntroSequence();
    if (plant.isOpen) plant.close(true);
    else plant.open();
    return;
  }
  if (isVoid) {
    cancelIntroSequence();
    enterVoid(unit);
    return;
  }
  if (!isHero) {
    jiggleLocked(unit);
    return;
  }
  cancelIntroSequence();
  if (drawerOpen) {
    setDrawer(false);
    clearTimeout(openingTimer);
    openingTimer = setTimeout(
      () => {
        cabinetFocused = false;
        wall.classList.remove("is-zoomed");
        one("#archiveView .archive-stage").classList.remove("is-project-zoom");
        lens.refresh();
      },
      reduced.matches ? 0 : 600,
    );
    return;
  }
  if (!cabinetFocused) {
    focusCabinet();
    clearTimeout(openingTimer);
    openingTimer = setTimeout(
      () => setDrawer(true),
      reduced.matches ? 0 : 1180,
    );
  } else setDrawer(true);
}
/* Three independent small stories live in the filing wall. Each drawer
   is clickable/keyboard-operable, and can be opened or put away again. */
function toggleStoryDrawer(
  unit,
  open = !unit.classList.contains("is-story-open"),
) {
  if (!unit || !unit.isConnected) return;
  const kind = unit.dataset.drawer;
  if (!["film", "phone", "ticket"].includes(kind)) return;
  unit.classList.toggle("is-story-open", open);
  unit.classList.toggle("is-story-shut", !open);
  const contact = unit.querySelector(".phone-contact-link");
  if (contact) {
    contact.tabIndex = open ? 0 : -1;
    contact.setAttribute("aria-hidden", String(!open));
    unit
      .querySelector(".phone-visual")
      ?.setAttribute("aria-hidden", String(!open));
  }
  const button = unit.querySelector(".drawer-click");
  if (button) {
    button.setAttribute("aria-expanded", String(open));
    const labels = {
      film: open
        ? "Cerrar cajón de película analógica"
        : "Abrir cajón de película analógica",
      phone: open ? "Guardar teléfono verde" : "Sacar teléfono verde",
      ticket: open
        ? "Guardar el ticket Sobre mí"
        : "Imprimir el ticket Sobre mí",
    };
    button.setAttribute("aria-label", labels[kind]);
  }
  if (kind === "ticket" && open) {
    // Replay the abrupt thermal-printer motion on every fresh opening.
    const paper = unit.querySelector(".ticket-paper");
    if (paper) {
      paper.style.animation = "none";
      void paper.offsetWidth;
      paper.style.removeProperty("animation");
    }
  }
  lens.refresh();
  setTimeout(lens.refresh, 1400);
}
function resetStoryDrawers() {
  for (const unit of [filmDrawer, phoneDrawer, ticketDrawer]) {
    if (unit) toggleStoryDrawer(unit, false);
  }
}
function enterVoid(unit) {
  if (voidBusy || activeView !== "archive") return;
  voidBusy = true;
  clearTimeout(openingTimer);
  if (drawerOpen) setDrawer(false);
  cabinetFocused = false;
  wall.classList.remove("is-zoomed");
  one("#archiveView .archive-stage").classList.remove("is-project-zoom");
  const x = ((unit.offsetLeft + unit.offsetWidth / 2) / wall.offsetWidth) * 100;
  const y =
    ((unit.offsetTop + unit.offsetHeight / 2) / wall.offsetHeight) * 100;
  wall.style.transformOrigin = x.toFixed(2) + "% " + y.toFixed(2) + "%";
  voidDrawer = unit;
  unit.classList.add("is-portal-awake");
  const transition = one("#voidTransition");
  const target = unit.getBoundingClientRect();
  transition.style.setProperty(
    "--portal-x",
    (target.left + target.width / 2).toFixed(1) + "px",
  );
  transition.style.setProperty(
    "--portal-y",
    (target.top + target.height / 2).toFixed(1) + "px",
  );
  transition.hidden = false;
  transition.classList.remove("is-exiting");
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      wall.classList.add("is-void-zoom");
      transition.classList.add("is-active");
      lens.refresh();
    }),
  );
  const duration = reduced.matches ? 75 : 1700;
  clearTimeout(voidTimer);
  voidTimer = setTimeout(() => {
    navigate("vacio", { animate: false });
    transition.classList.add("is-exiting");
    setTimeout(
      () => {
        transition.classList.remove("is-active", "is-exiting");
        transition.hidden = true;
        unit.classList.remove("is-portal-awake");
        voidBusy = false;
        lens.refresh();
      },
      reduced.matches ? 10 : 580,
    );
  }, duration);
}
/** Cancellable archive introduction. */
function cancelIntroSequence() {
  introTimers.forEach(clearTimeout);
  introTimers = [];
  introSequenceActive = false;
}
function introAfter(delay, action) {
  introTimers.push(
    setTimeout(
      () => {
        if (activeView === "archive" && introSequenceActive && !voidBusy)
          action();
      },
      reduced.matches ? 0 : delay,
    ),
  );
}
/* The impact is physically linked to the camera stopping: the entire wall
   rattles, then each front settles ajar by a few millimetres. */
function resetImpactDrawers() {
  many("#cabinetCells .drawer-unit").forEach((unit) => {
    unit.classList.remove("is-impact-ajar", "is-impact-rattling");
    unit.style.removeProperty("--impact-delay");
    unit.style.removeProperty("--impact-open");
  });
}
function hitArchiveWall() {
  const drawers = many("#cabinetCells .drawer-unit");
  drawers.forEach((unit, index) => {
    const row = Math.floor(index / (layoutIsSmall ? 9 : 15));
    const stagger = (index * 41 + row * 23) % 410;
    unit.style.setProperty("--impact-delay", stagger + "ms");
    unit.style.setProperty("--impact-open", 7 + ((index * 7) % 10) + "%");
    unit.classList.add("is-impact-ajar", "is-impact-rattling");
  });
  introAfter(950, () => {
    drawers.forEach((unit) => unit.classList.remove("is-impact-rattling"));
  });
  one("#drawerInstruction").textContent =
    "El impacto ha sacudido la pared. Explora los cajones: el 023 contiene tus proyectos y el 099 lleva al Vacío.";
  one("#roomViewStatus").textContent =
    "La sala se ha abierto. Ahora puedes explorar los cajones.";
  lens.refresh();
}
function resetArchiveIntro() {
  cancelIntroSequence();
  introPlayed = false;
  resetImpactDrawers();
  plant.close(false);
  resetStoryDrawers();
  hero?.classList.remove("is-shaking", "is-inviting");
  voidDrawer?.classList.remove("is-shaking", "is-inviting");
}
function runArchiveIntro() {
  if (introPlayed || activeView !== "archive") return;
  introPlayed = true;
  introSequenceActive = true;
  plant.close(false);
  resetStoryDrawers();
  hitArchiveWall();
  // Objects reveal themselves AFTER the full-wall shock.
  introAfter(480, () => plant.open());
  introAfter(1470, () => toggleStoryDrawer(filmDrawer, true));
  introAfter(2440, () => toggleStoryDrawer(phoneDrawer, true));
  introAfter(3420, () => toggleStoryDrawer(ticketDrawer, true));
  introAfter(5300, () => {
    introSequenceActive = false;
    lens.refresh();
  });
}
function sweepCards(position) {
  if (!drawerOpen || picking) return;
  const cards = many("#fileStack .file-tab");
  const clones = many("#cursorReplica .file-tab");
  cards.forEach((card, i) => {
    const distance = Math.abs(i - position);
    const proximity = Math.max(0, 1 - distance * 0.75);
    // Longer dossiers remain partially inside the drawer even when lifted.
    const offset = proximity > 0 ? -34 * proximity : i > position ? 8 : 0;
    const scale = 1 + proximity * 0.065;
    const tilt = -8 * proximity;
    for (const node of [card, clones[i]].filter(Boolean)) {
      node.style.setProperty("--paper-offset", offset.toFixed(1) + "%");
      node.style.setProperty("--paper-scale", scale.toFixed(3));
      node.style.setProperty("--paper-tilt", tilt.toFixed(1) + "deg");
      node.style.setProperty("--paper-light", proximity.toFixed(2));
      node.classList.toggle("is-under-hand", proximity > 0.4);
    }
  });
}
function fanCards(i) {
  sweepCards(i);
}
function clearFan() {
  many("#fileStack .file-tab, #cursorReplica .file-tab").forEach((card) => {
    for (const key of [
      "--paper-offset",
      "--paper-scale",
      "--paper-tilt",
      "--paper-light",
    ])
      card.style.removeProperty(key);
    card.classList.remove("is-under-hand", "is-selected");
  });
}
function pickFolder(i) {
  if (!drawerOpen || picking) return;
  picking = true;
  const cards = many("#fileStack .file-tab");
  clearFan();
  cards[i].classList.add("is-selected");
  setTimeout(
    () => {
      picking = false;
      if (drawerOpen && activeView === "archive") dialog.open(i);
    },
    reduced.matches ? 0 : 420,
  );
}
function switchView(view, animate = true) {
  if (!views[view] || navigating || view === activeView) return;
  dialog.close(false);
  const apply = () => {
    one("#homeView").hidden = view === "about" || view === "vacio";
    one("#aboutView").hidden = view !== "about";
    one("#voidView").hidden = view !== "vacio";
    one("#archiveView").inert = view !== "archive";
    activeView = view;
    document.body.classList.toggle("is-archive", view === "archive");
    document.body.classList.toggle("is-home", view === "home");
    document.body.classList.toggle("is-void", view === "vacio");
    if (view === "home") {
      resetCabinet();
      resetArchiveIntro();
      room.start();
    } else if (view === "archive") {
      room.stop();
      room.settle();
      runArchiveIntro();
    } else {
      room.stop();
      resetCabinet();
      cancelIntroSequence();
    }
    many(".nav a").forEach((link) => {
      if (link.dataset.view === view) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    window.scrollTo({ top: 0, behavior: "instant" });
    lens.refresh();
  };
  const sameScene =
    (activeView === "home" && view === "archive") ||
    (activeView === "archive" && view === "home");
  if (animate && !reduced.matches && !sameScene) {
    navigating = true;
    const screen = one("#transitionScreen");
    screen.classList.remove("leave");
    screen.classList.add("on");
    setTimeout(() => {
      apply();
      screen.classList.remove("on");
      screen.classList.add("leave");
      setTimeout(() => {
        screen.classList.remove("leave");
        navigating = false;
        lens.refresh();
      }, 490);
    }, 490);
  } else apply();
}
many("[data-view]").forEach((link) =>
  link.addEventListener("click", (event) => {
    event.preventDefault();
    if (navigating) return;
    const view = link.dataset.view;
    if (activeView === view) return;
    navigate(view);
  }),
);
addEventListener("popstate", () => switchView(routeFromHash(), false));
addEventListener("hashchange", () => switchView(routeFromHash(), false));
addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (activeView === "vacio") {
      navigate("archive", { animate: false });
      return;
    }
    if (!one("#projectModal").hidden) dialog.close();
    else if (drawerOpen || cabinetFocused) resetCabinet();
    return;
  }
  dialog.trapFocus(event);
});

buildWall();
setDrawer(false);
switchView(routeFromHash(), false);

addEventListener("resize", () => {
  const small = innerWidth < 700;
  if (small !== layoutIsSmall) {
    resetCabinet();
    buildWall();
  }
});
