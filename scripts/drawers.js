/** Drawer DOM construction. Behavior is supplied by the archive controller. */
export function createDrawer(
  { index, col, row, heroCell, voidCell, plantCell, storyType },
  { onDrawerClick, onStoryClick, contactHref },
) {
  // Reserve 023 and 099 for the special drawers without duplicate serial numbers.
  let serial = index + 1;
  if (serial >= 23) serial++;
  if (serial >= 99) serial++;
  const id = heroCell
    ? "023"
    : voidCell
      ? "099"
      : String(serial).padStart(3, "0");
  const unit = document.createElement("div");
  unit.className =
    "drawer-unit" +
    (heroCell ? " is-hero" : "") +
    (voidCell ? " is-void-drawer" : "") +
    (plantCell ? " is-plant-drawer" : "") +
    (storyType ? " is-story-drawer is-story-" + storyType : "");
  unit.style.gridColumn = String(col + 1);
  unit.style.gridRow = String(row + 1);
  unit.dataset.drawer = heroCell
    ? "middle"
    : voidCell
      ? "vacio"
      : plantCell
        ? "plant"
        : storyType || "locked";
  unit.dataset.number = id;
  if (plantCell) {
    const cavity = document.createElement("div");
    cavity.className = "plant-cavity";
    cavity.setAttribute("aria-hidden", "true");
    const sprout = document.createElement("img");
    sprout.src = "assets/plant-sprout-v15.svg";
    sprout.alt = "";
    sprout.className = "plant-sprout";
    sprout.loading = "eager";
    sprout.decoding = "async";
    const pixels = document.createElement("canvas");
    pixels.className = "plant-pixels";
    pixels.width = 360;
    pixels.height = 342;
    pixels.setAttribute("aria-hidden", "true");
    unit.append(cavity, pixels, sprout);
  }
  if (storyType) {
    const cavity = document.createElement("div");
    cavity.className = "story-cavity";
    cavity.setAttribute("aria-hidden", "true");
    unit.append(cavity);
    const visual = document.createElement("div");
    visual.className = "story-visual " + storyType + "-visual";
    visual.setAttribute("aria-hidden", "true");
    if (storyType === "film") {
      visual.innerHTML =
        '<div class="film-roller"></div><div class="film-ribbon">' +
        Array.from(
          { length: 9 },
          (_, i) =>
            '<div class="film-frame film-frame-' +
            (i % 5) +
            '"><span class="film-frame-image"></span><span class="film-frame-index">' +
            String(i + 1).padStart(2, "0") +
            "</span></div>",
        ).join("") +
        '</div><span class="film-tail"></span>';
    } else if (storyType === "phone") {
      visual.innerHTML =
        '<svg class="phone-coil" viewBox="0 0 160 260" preserveAspectRatio="none" aria-hidden="true">' +
        '<path d="M80 0 C20 17 140 30 80 44 S20 70 80 84 S140 112 80 126 S20 153 80 166 S140 196 80 209 S20 235 80 260" stroke="#334d3b" stroke-width="5" fill="none" stroke-linecap="round"/>' +
        '<path d="M80 0 C20 17 140 30 80 44 S20 70 80 84 S140 112 80 126 S20 153 80 166 S140 196 80 209 S20 235 80 260" stroke="#a8bf95" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".65"/></svg>' +
        '<a class="phone-contact-link" href="' +
        contactHref +
        '" aria-label="Escribir un correo a EFEDEGAM" title="Enviar un correo"><img class="phone-handset" src="assets/telefono-oliva-v18.svg" alt="" draggable="false"></a>';
      const mailLink = visual.querySelector(".phone-contact-link");
      mailLink.tabIndex = -1;
      mailLink.setAttribute("aria-hidden", "true");
      mailLink.addEventListener("click", (event) => event.stopPropagation());
      mailLink.addEventListener("pointerdown", (event) =>
        event.stopPropagation(),
      );
    } else {
      visual.innerHTML =
        '<div class="ticket-feeder"></div><div class="ticket-paper">' +
        '<div class="ticket-brand">EFEDEGAM</div>' +
        '<div class="ticket-meta">RECIBO Nº 018<br>ARCHIVO PERSONAL · 2026</div>' +
        '<div class="ticket-rule">--------------------------------</div>' +
        '<div class="ticket-title">UN POCO SOBRE MÍ</div>' +
        "<p>Este archivo guarda cosas que me gustan, ideas que encuentro y proyectos que voy haciendo.</p>" +
        "<p>Arquitectura, imágenes, dibujos, fotografías y objetos. A veces todo mezclado.</p>" +
        '<div class="ticket-rule">--------------------------------</div>' +
        "<p>NO ES UN CATÁLOGO.<br>ES UN DIARIO EN CONSTRUCCIÓN.</p>" +
        '<div class="ticket-foot">FIN (POR AHORA) ✳<br>* TEXTO PROVISIONAL *</div>' +
        "</div>";
    }
    visual.addEventListener("click", (event) => {
      if (event.target.closest(".phone-contact-link")) return;
      onStoryClick(unit);
    });
    unit.append(visual);
  }
  if (heroCell) {
    const cavity = document.createElement("div");
    cavity.className = "drawer-cavity";
    unit.append(cavity);
    const tray = document.createElement("div");
    tray.className = "drawer-assembly";
    tray.innerHTML =
      '<div class="drawer-tray-floor"></div><div class="drawer-tray-side drawer-tray-side--left"></div><div class="drawer-tray-side drawer-tray-side--right"></div><div class="drawer-tray-rim"></div>';
    unit.append(tray);
    const files = document.createElement("div");
    files.className = "file-tray-files";
    files.id = "fileStack";
    files.setAttribute("aria-label", "Carpetas del cajón de proyectos");
    unit.append(files);
  }
  const front = document.createElement("div");
  front.className = "drawer-face";
  front.innerHTML =
    '<span class="drawer-card-label">' +
    (heroCell ? "PROYECTOS" : voidCell ? "ARCHIVO ESPECIAL" : "F. " + id) +
    '</span><span class="drawer-handle"></span><span class="drawer-id">' +
    id +
    "</span>" +
    (voidCell ? '<span class="drawer-void-sticker">EL VACÍO</span>' : "");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "drawer-click";
  button.setAttribute(
    "aria-label",
    heroCell
      ? "Acercar y abrir el cajón 023 de proyectos"
      : voidCell
        ? "Abrir cajón 099 y entrar en El Vacío"
        : plantCell
          ? "Abrir el cajón de la planta"
          : storyType
            ? {
                film: "Abrir cajón de película analógica",
                phone: "Abrir cajón del teléfono verde",
                ticket: "Abrir cajón del ticket Sobre mí",
              }[storyType]
            : "Cajón " + id + " cerrado con llave",
  );
  if (heroCell) {
    button.setAttribute("aria-controls", "fileStack");
    button.setAttribute("aria-expanded", "false");
  }
  if (plantCell || storyType) button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", () =>
    onDrawerClick(unit, heroCell, voidCell, plantCell, storyType),
  );
  front.append(button);
  unit.append(front);
  return unit;
}
