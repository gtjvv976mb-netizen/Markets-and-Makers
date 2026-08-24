import { BUSINESS, CIVIC_BUILDINGS, PLOTS, RESOURCES, MOLLAR_CODE, type ResourceKey } from "./data";
import type { BusinessRecord } from "./state";

export interface MarkerModel {
  id: string;
  kind: string;
  label: string;
  title: string;
  detail: string;
  x: number;
  y: number;
  z: number;
  building: boolean;
  icon?: string;
  accent?: string;
}

interface PropertyMarkerState {
  island: string;
  portfolio: Record<string, BusinessRecord>;
}

const PLAYER_BUILDING_FALLBACK_Y = 7.2;
const PLOT_BANNER_Y = 3.2;

export function propertyMarkerModels(
  state: PropertyMarkerState,
  marketBuyPrice: (resource: ResourceKey) => number,
  buildingBannerY: (plotId: string) => number | null,
): MarkerModel[] {
  const civicMarkers = CIVIC_BUILDINGS
    .filter((building) => building.island === state.island)
    .map((building): MarkerModel => {
      const supply = building.supplies
        .map((resource) => `${RESOURCES[resource].short} ${marketBuyPrice(resource)} ${MOLLAR_CODE}`)
        .join(" · ");
      return {
        id: `civic-${building.id}`,
        kind: "civic",
        label: building.supplies.length ? "Civic supplier" : "Civic landmark",
        title: building.name,
        detail: supply || building.role,
        x: building.x,
        y: building.bannerY,
        z: building.z,
        building: true,
        icon: building.icon,
        accent: building.color,
      };
    });

  const plotMarkers = PLOTS
    .filter((plot) => plot.island === state.island)
    .map((plot): MarkerModel => {
      const record = state.portfolio[plot.id];
      const plotName = plot.name.replace(/ Plot$/, "");
      if (!record) {
        return {
          id: plot.id,
          kind: "vacant",
          label: "For lease",
          title: plotName,
          detail: `${plot.price} ${MOLLAR_CODE}`,
          x: plot.x,
          y: PLOT_BANNER_Y,
          z: plot.z,
          building: false,
          icon: "⌂",
          accent: "#edb742",
        };
      }
      if (!record.license) {
        return {
          id: plot.id,
          kind: "owned",
          label: "Yours",
          title: plotName,
          detail: "Choose a trade",
          x: plot.x,
          y: PLOT_BANNER_Y,
          z: plot.z,
          building: false,
          icon: "⌂",
          accent: "#8fd176",
        };
      }

      const config = BUSINESS[record.license];
      if (!record.buildingPlaced) {
        return {
          id: plot.id,
          kind: "owned",
          label: "Ready to build",
          title: config.name,
          detail: "Tap to build",
          x: plot.x,
          y: PLOT_BANNER_Y,
          z: plot.z,
          building: false,
          icon: config.icon,
          accent: config.color,
        };
      }

      const base = {
        id: plot.id,
        title: config.name,
        x: plot.x,
        y: buildingBannerY(plot.id) ?? PLAYER_BUILDING_FALLBACK_Y,
        z: plot.z,
        building: true,
        icon: config.icon,
        accent: config.color,
      };
      if (record.brokenDown) {
        return { ...base, kind: "alert", label: "Broken down", detail: "Needs a repair crew" };
      }
      if (record.job) {
        const left = record.job.completeAt - Date.now();
        return left > 0
          ? { ...base, kind: "owned", label: "Working", detail: formatWait(left) }
          : { ...base, kind: "ready", label: "Ready", detail: "Collect your goods" };
      }
      return { ...base, kind: "owned", label: "Open", detail: "Tap to manage" };
    });

  return [...civicMarkers, ...plotMarkers];
}

function formatWait(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s remaining`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes}m remaining`;
}
