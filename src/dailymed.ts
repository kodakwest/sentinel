import type { DrugRecord } from "./types";

interface DailyMedDrugName {
  drug_name?: string;
  route?: string[];
}

interface DailyMedNamesResponse {
  data?: DailyMedDrugName[];
}

export async function fetchDailyMedDrug(name: string): Promise<Partial<DrugRecord>> {
  const url = `https://dailymed.nlm.nih.gov/dailymed/services/v2/drugnames?name=${encodeURIComponent(name)}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`DailyMed returned ${response.status}`);

  const payload = (await response.json()) as DailyMedNamesResponse;
  const names = payload.data ?? [];
  const exact = names.find((item) => item.drug_name?.toLowerCase() === name.toLowerCase()) ?? names[0];
  const brandNames = unique(names.map((item) => item.drug_name).filter(Boolean) as string[]).slice(0, 8);
  const routes = unique(names.flatMap((item) => item.route ?? []));

  return {
    name: titleCase(exact?.drug_name ?? name),
    generic_name: name.toLowerCase(),
    brand_names: brandNames,
    administration: routes.length ? `Known DailyMed routes: ${routes.join(", ")}` : null,
    source: "dailymed"
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
