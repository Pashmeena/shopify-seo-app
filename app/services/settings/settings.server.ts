import type { ShopSettings } from "@prisma/client";
import prisma from "../../db.server";
import { parseJsonArray } from "../../lib/json";

/** ShopSettings with JSON columns parsed for consumers. */
export interface ResolvedSettings extends ShopSettings {
  enabledLocaleCodes: string[];
  competitorUrlList: string[];
}

function resolve(settings: ShopSettings): ResolvedSettings {
  return {
    ...settings,
    enabledLocaleCodes: parseJsonArray<string>(settings.enabledLocales),
    competitorUrlList: parseJsonArray<string>(settings.competitorUrls),
  };
}

/** Fetch (creating on first use) the shop's settings. */
export async function getSettings(shop: string): Promise<ResolvedSettings> {
  const settings = await prisma.shopSettings.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
  return resolve(settings);
}

export interface SettingsUpdate {
  brandName?: string;
  brandTone?: string;
  defaultLocale?: string;
  enabledLocaleCodes?: string[];
  competitorUrlList?: string[];
  blogHandle?: string;
  minProducts?: number;
  catalogSeeded?: boolean;
}

export async function updateSettings(
  shop: string,
  update: SettingsUpdate,
): Promise<ResolvedSettings> {
  const { enabledLocaleCodes, competitorUrlList, ...scalar } = update;
  const settings = await prisma.shopSettings.update({
    where: { shop },
    data: {
      ...scalar,
      ...(enabledLocaleCodes ? { enabledLocales: JSON.stringify(enabledLocaleCodes) } : {}),
      ...(competitorUrlList ? { competitorUrls: JSON.stringify(competitorUrlList) } : {}),
    },
  });
  return resolve(settings);
}
