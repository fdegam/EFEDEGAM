/**
 * Special drawers of the archive. Edit names or move a drawer here.
 * `id` is the drawer in the Blender model: C = column 01–13 (left to right),
 * F = row 01–12 (top to bottom). Positions follow the V20 composition.
 * Only "023" has content today; the other five keep their names and wait
 * for their real content (`status: "pending"`).
 */
export const specialDrawers = [
  { id: "C07_F06", code: "023", name: "Proyectos", kind: "projects" },
  { id: "C11_F05", code: "099", name: "El vacío", kind: "pending" },
  { id: "C04_F09", code: "", name: "Planta pixelada", kind: "pending" },
  { id: "C04_F02", code: "", name: "Película analógica", kind: "pending" },
  { id: "C11_F08", code: "", name: "Teléfono", kind: "pending" },
  { id: "C10_F04", code: "", name: "Ticket", kind: "pending" },
];
