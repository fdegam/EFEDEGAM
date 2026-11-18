/**
 * Special drawers of the archive. Edit names or move a drawer here.
 * `id` is the drawer in the Blender model: C = column 01–13 (left to right),
 * F = row 01–12 (top to bottom). Positions follow the V20 composition.
 * Only "023" has content today; the other five keep their names and wait
 * for their real content (`status: "pending"`).
 * `sticker` is the colour of the paper sticker on the drawer front.
 */
export const specialDrawers = [
  {
    id: "C07_F06",
    code: "023",
    name: "Proyectos",
    kind: "projects",
    sticker: "#e0562d",
  },
  {
    id: "C11_F05",
    code: "099",
    name: "El vacío",
    kind: "pending",
    sticker: "#1d1d1b",
  },
  {
    id: "C04_F09",
    code: "",
    name: "Plantimanía",
    kind: "plant", // opens to a pixel ivy that takes the room (scripts/space/ivy.js)
    sticker: "#6f9a52",
  },
  {
    id: "C04_F02",
    code: "",
    name: "Película analógica",
    kind: "pending",
    sticker: "#e3b23c",
  },
  {
    id: "C11_F08",
    code: "",
    name: "Teléfono",
    kind: "pending",
    sticker: "#3f6b4f",
  },
  {
    id: "C10_F04",
    code: "",
    name: "Ticket",
    kind: "pending",
    sticker: "#e9e4d3",
  },
];
