import type { Tile } from "./api";

// Shared by /dashboard and /manage/analytics — both derive "the one node the
// caller is currently focused on" from the same tiles array, so this lives
// here once instead of being copy-pasted into both page components.
export type Focus = { level: "college" | "department" | "class"; nodeId: string; classId?: string; tile: Tile };

const PRECEDENCE: Record<Tile["type"], number> = {
  college: 4,
  department: 3,
  class: 2,
  "teacher-class": 1,
};

export function focusOf(tiles: Tile[]): Focus | null {
  if (tiles.length === 0) return null;
  const tile = [...tiles].sort((a, b) => PRECEDENCE[b.type] - PRECEDENCE[a.type])[0]!;
  switch (tile.type) {
    case "college":
      return { level: "college", nodeId: tile.collegeId, tile };
    case "department":
      return { level: "department", nodeId: tile.departmentId, tile };
    case "class":
      return { level: "class", nodeId: tile.classId, classId: tile.classId, tile };
    case "teacher-class":
      return { level: "class", nodeId: tile.classId, classId: tile.classId, tile };
  }
}
