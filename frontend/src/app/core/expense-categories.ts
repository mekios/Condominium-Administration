/** Shared expense category config with icons and display rules */

export type ExpenseCategoryConfig = {
  value: string;
  label: string;
  iconPath: string;
  /** When true, show expense.description as label in lists (fallback to category label if empty) */
  useDescriptionAsLabel: boolean;
};

export const EXPENSE_CATEGORIES: ExpenseCategoryConfig[] = [
  { value: 'gardener', label: 'Κηπουρός', iconPath: 'M12 2l1.6 3.5L17 4l-.6 3.8L20 9l-3.2 1.8L18 14l-3.8-.7L12 17l-2.2-3.7L6 14l1.2-3.2L4 9l3.6-1.2L7 4l3.4 1.5L12 2zM12 17v5', useDescriptionAsLabel: false },
  { value: 'common_power_usage', label: 'Κοινόχρηστο ρεύμα', iconPath: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z', useDescriptionAsLabel: false },
  { value: 'common_water_usage', label: 'Κοινόχρηστο νερό', iconPath: 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z', useDescriptionAsLabel: false },
  { value: 'cleaning', label: 'Καθαρισμός', iconPath: 'M16 3l2 2-6 6v2h-2v-2zM6 14h8l2 6H4zM7 15v4M9 15v4M11 15v4M13 15v4', useDescriptionAsLabel: false },
  { value: 'elevator_service', label: 'Συντήρηση ανελκυστήρα', iconPath: 'M7 3h10v18H7zM9 8h6M9 16h6M12 6l-2 2h4l-2-2zM12 18l2-2h-4l2 2z', useDescriptionAsLabel: false },
  { value: 'gas_heating_bill', label: 'Φυσικό αέριο θέρμανσης', iconPath: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z', useDescriptionAsLabel: false },
  { value: 'water_hw_consumption_bill', label: 'Κατανάλωση ζεστού νερού', iconPath: 'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z', useDescriptionAsLabel: false },
  { value: 'gas_hw_consumption_bill', label: 'Φυσικό αέριο ζεστού νερού', iconPath: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z', useDescriptionAsLabel: false },
  { value: 'damages', label: 'Ζημιές', iconPath: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z', useDescriptionAsLabel: true },
  { value: 'annual_servicing', label: 'Ετήσια συντήρηση', iconPath: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z', useDescriptionAsLabel: true },
  { value: 'owners_only', label: 'Έξοδα μόνο ιδιοκτητών', iconPath: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4', useDescriptionAsLabel: true },
  { value: 'fund_increase', label: 'Αύξηση αποθεματικού', iconPath: 'M5.5 17a6.5 1.7 0 1 0 13 0a6.5 1.7 0 1 0 -13 0M6.5 12.5a5.5 1.5 0 1 0 11 0a5.5 1.5 0 1 0 -11 0M7.5 8.5a4.5 1.3 0 1 0 9 0a4.5 1.3 0 1 0 -9 0', useDescriptionAsLabel: true },
  { value: 'other', label: 'Λοιπά', iconPath: 'M9 5h6M9 9h6M9 13h6', useDescriptionAsLabel: true },
];

const DESCRIPTION_AS_LABEL_VALUES = new Set(
  EXPENSE_CATEGORIES.filter((c) => c.useDescriptionAsLabel).map((c) => c.value)
);

export function categoryUsesDescriptionAsLabel(value: string): boolean {
  return DESCRIPTION_AS_LABEL_VALUES.has(value);
}

export function getCategoryConfig(value: string): ExpenseCategoryConfig | undefined {
  return EXPENSE_CATEGORIES.find((c) => c.value === value);
}

export function getDisplayLabel(expense: { expense_category: string; description?: string }): string {
  const cfg = getCategoryConfig(expense.expense_category);
  if (cfg?.useDescriptionAsLabel && expense.description?.trim()) {
    return `${cfg.label}: ${expense.description.trim()}`;
  }
  return cfg?.label ?? expense.expense_category;
}

export function getIconPath(category: string): string | null {
  return getCategoryConfig(category)?.iconPath ?? null;
}

const CATEGORY_COLORS: Record<string, string> = {
  gardener: '#47ff78',
  common_power_usage: '#42e7ff',
  common_water_usage: '#55b9ff',
  cleaning: '#9be35f',
  elevator_service: '#a9b6ff',
  gas_heating_bill: '#ff8dbd',
  water_hw_consumption_bill: '#5fd3ff',
  gas_hw_consumption_bill: '#ff9ed8',
  damages: '#ff7c7c',
  annual_servicing: '#c0a5ff',
  owners_only: '#ffd37d',
  fund_increase: '#7dffb0',
  other: '#c5d2ff',
};

const CATEGORY_GLOWS: Record<string, string> = {
  gardener: 'drop-shadow(0 0 8px rgba(71, 255, 120, 0.65))',
  common_power_usage: 'drop-shadow(0 0 7px rgba(66, 231, 255, 0.55))',
  common_water_usage: 'drop-shadow(0 0 7px rgba(85, 185, 255, 0.55))',
  cleaning: 'drop-shadow(0 0 7px rgba(155, 227, 95, 0.5))',
  elevator_service: 'drop-shadow(0 0 7px rgba(169, 182, 255, 0.5))',
  gas_heating_bill: 'drop-shadow(0 0 7px rgba(255, 141, 189, 0.58))',
  water_hw_consumption_bill: 'drop-shadow(0 0 7px rgba(95, 211, 255, 0.58))',
  gas_hw_consumption_bill: 'drop-shadow(0 0 7px rgba(255, 158, 216, 0.58))',
  damages: 'drop-shadow(0 0 7px rgba(255, 124, 124, 0.55))',
  annual_servicing: 'drop-shadow(0 0 7px rgba(192, 165, 255, 0.5))',
  owners_only: 'drop-shadow(0 0 7px rgba(255, 211, 125, 0.52))',
  fund_increase: 'drop-shadow(0 0 8px rgba(125, 255, 176, 0.58))',
  other: 'drop-shadow(0 0 6px rgba(197, 210, 255, 0.4))',
};

export function getCategoryIconColor(category: string): string {
  return CATEGORY_COLORS[category] ?? '#a9bde9';
}

export function getCategoryIconGlow(category: string): string {
  return CATEGORY_GLOWS[category] ?? 'drop-shadow(0 0 6px rgba(169, 189, 233, 0.35))';
}

export function isFundIncreaseCategory(category: string): boolean {
  return category === 'fund_increase';
}
