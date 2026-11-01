import { reduced } from "./dom.js";

export function createPlant(getDrawer, onChange) {
  let plantProgress = 0,
    plantFrame = 0,
    plantTargetOpen = false,
    plantRaster = null,
    plantRasterLoading = false;
  function cancelPlantFrame() {
    if (plantFrame) cancelAnimationFrame(plantFrame);
    plantFrame = 0;
  }
  function preparePlantRaster(img) {
    if (plantRaster) return true;
    if (!img.complete || !img.naturalWidth) return false;
    const sampling = document.createElement("canvas");
    sampling.width = 120;
    sampling.height = 114;
    const brush = sampling.getContext("2d", { willReadFrequently: true });
    if (!brush) return false;
    try {
      brush.clearRect(0, 0, 120, 114);
      brush.drawImage(img, 0, 0, 120, 114);
      const data = brush.getImageData(0, 0, 120, 114).data;
      const cells = [];
      for (let y = 0; y < 114; y++)
        for (let x = 0; x < 120; x++) {
          const pos = (y * 120 + x) * 4,
            alpha = data[pos + 3];
          if (alpha < 45) continue;
          const noise =
            (((Math.imul(x + 11, 73856093) ^ Math.imul(y + 17, 19349663)) >>>
              0) %
              1000) /
            1000;
          const threshold = Math.min(0.99, (1 - y / 113) * 0.84 + noise * 0.16);
          cells.push({
            x: x * 3,
            y: y * 3,
            color:
              "rgba(" +
              data[pos] +
              "," +
              data[pos + 1] +
              "," +
              data[pos + 2] +
              "," +
              (alpha / 255).toFixed(2) +
              ")",
            threshold,
          });
        }
      plantRaster = cells;
      return true;
    } catch (error) {
      return false;
    }
  }
  function renderPlantPixels(progress) {
    const canvas = getDrawer()?.querySelector(".plant-pixels");
    if (!canvas || !plantRaster) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const cell of plantRaster) {
      if (cell.threshold > progress) continue;
      ctx.fillStyle = cell.color;
      ctx.fillRect(cell.x, cell.y, 3, 3);
    }
  }
  function setPlantFullyClosed() {
    if (!getDrawer()) return;
    getDrawer().classList.remove(
      "is-sprouting",
      "is-grown",
      "is-pixel-growing",
      "is-pixel-closing",
      "is-raster-fallback",
      "plant-gentle-shake",
      "is-shaking",
      "is-inviting",
    );
    getDrawer()
      .querySelector(".drawer-click")
      ?.setAttribute("aria-expanded", "false");
    getDrawer()
      .querySelector(".drawer-click")
      ?.setAttribute("aria-label", "Abrir el cajón de la planta");
    plantProgress = 0;
    renderPlantPixels(0);
  }
  function animatePlantTo(open) {
    if (!getDrawer() || !getDrawer().isConnected) return;
    plantTargetOpen = open;
    cancelPlantFrame();
    const img = getDrawer().querySelector(".plant-sprout");
    if (!preparePlantRaster(img)) {
      // If the image loaded but canvas sampling is unsupported, retain a usable
      // static plant instead of leaving an empty drawer.
      if (img?.complete && img?.naturalWidth) {
        getDrawer().classList.toggle("is-sprouting", open);
        getDrawer().classList.toggle("is-grown", open);
        getDrawer().classList.toggle("is-raster-fallback", open);
        getDrawer()
          .querySelector(".drawer-click")
          ?.setAttribute("aria-expanded", String(open));
        if (!open) setPlantFullyClosed();
        return;
      }
      if (img && !plantRasterLoading) {
        plantRasterLoading = true;
        const onLoad = () => {
          plantRasterLoading = false;
          if (plantTargetOpen) animatePlantTo(true);
        };
        img.addEventListener("load", onLoad, { once: true });
        img.addEventListener(
          "error",
          () => {
            plantRasterLoading = false;
            if (plantTargetOpen) {
              getDrawer().classList.add("is-grown", "is-raster-fallback");
            }
          },
          { once: true },
        );
      }
      if (open) {
        getDrawer().classList.add("is-sprouting");
        getDrawer().classList.remove("is-grown");
        getDrawer()
          .querySelector(".drawer-click")
          ?.setAttribute("aria-expanded", "true");
      } else setPlantFullyClosed();
      return;
    }
    getDrawer().classList.remove("is-raster-fallback");
    getDrawer().classList.add("is-sprouting");
    getDrawer().classList.toggle("is-pixel-growing", open);
    getDrawer().classList.toggle("is-pixel-closing", !open);
    getDrawer().classList.remove("is-grown");
    getDrawer()
      .querySelector(".drawer-click")
      ?.setAttribute("aria-expanded", String(open));
    getDrawer()
      .querySelector(".drawer-click")
      ?.setAttribute(
        "aria-label",
        open ? "Cerrar el cajón de la planta" : "Abrir el cajón de la planta",
      );
    if (reduced.matches) {
      plantProgress = open ? 1 : 0;
      renderPlantPixels(plantProgress);
      if (open) getDrawer().classList.add("is-grown");
      else setPlantFullyClosed();
      return;
    }
    const startProgress = plantProgress,
      goal = open ? 1 : 0;
    const duration = Math.max(
      180,
      Math.abs(goal - startProgress) * (open ? 2700 : 1250),
    );
    const start = performance.now();
    function tick(now) {
      if (!getDrawer() || !getDrawer().isConnected) return;
      const t = Math.min(1, (now - start) / duration);
      const eased = t * t * (3 - 2 * t);
      plantProgress = startProgress + (goal - startProgress) * eased;
      renderPlantPixels(plantProgress);
      if (t < 1) {
        plantFrame = requestAnimationFrame(tick);
        return;
      }
      plantFrame = 0;
      if (open) {
        getDrawer().classList.remove("is-pixel-growing");
        getDrawer().classList.add("is-grown");
      } else setPlantFullyClosed();
      onChange();
    }
    plantFrame = requestAnimationFrame(tick);
    onChange();
  }
  function closePlantDrawer(animate = false) {
    plantTargetOpen = false;
    if (!getDrawer()) return;
    if (animate && plantProgress > 0) animatePlantTo(false);
    else {
      cancelPlantFrame();
      setPlantFullyClosed();
      onChange();
    }
  }
  function openPlantDrawer() {
    if (!getDrawer() || !getDrawer().isConnected) return;
    animatePlantTo(true);
  }

  return {
    open: openPlantDrawer,
    close: closePlantDrawer,
    get isOpen() {
      return plantTargetOpen;
    },
    reset() {
      cancelPlantFrame();
      plantRaster = null;
      plantRasterLoading = false;
      plantProgress = 0;
      plantTargetOpen = false;
    },
  };
}
