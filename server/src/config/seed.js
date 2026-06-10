// Default cost-config rows (PLAN.md §4.3, §4.4). These are starter values the
// user is expected to replace with their own real quotes on the Configuration
// page. They are seeded once and never overwrite later user edits.
//
// NOTE: amounts here are placeholders to make the app runnable out of the box —
// they are NOT authoritative. The whole point of the config store is that the
// user enters real, negotiated values.

export const SEED_COST_CONFIG = [
  // --- Transport methods ---
  {
    key: 'transport.enclosed',
    label: 'Enclosed transporter',
    category: 'transport',
    amount_eur: 1000,
    enabled: 1,
    notes: 'Market ref ~€800–€1,200. Replace with your transporter quote.',
  },
  {
    key: 'transport.open_carrier',
    label: 'Open carrier',
    category: 'transport',
    amount_eur: 600,
    enabled: 1,
    notes: 'Market ref ~€500–€700. Replace with your transporter quote.',
  },
  {
    key: 'transport.drive_down',
    label: 'Drive down (fuel + time)',
    category: 'transport',
    amount_eur: 450,
    enabled: 1,
    notes: 'Fuel, tolls, accommodation. Replace with your estimate.',
  },

  // --- Legalisation & registration fees ---
  {
    key: 'fee.dua_registration',
    label: 'DUA / IMT registration',
    category: 'legalisation',
    amount_eur: 65,
    enabled: 1,
    notes: 'Official IMT / registration tariff.',
  },
  {
    key: 'fee.inspection_ipo',
    label: 'Inspection (IPO Modelo B)',
    category: 'legalisation',
    amount_eur: 120,
    enabled: 1,
    notes: 'Real IPO centre price for imported-vehicle inspection.',
  },
  {
    key: 'fee.dav_customs',
    label: 'Customs declaration (DAV)',
    category: 'legalisation',
    amount_eur: 55,
    enabled: 1,
    notes: 'Customs declaration cost, if applicable.',
  },
  {
    key: 'fee.agent_dispatcher',
    label: 'Dispatcher / agent',
    category: 'legalisation',
    amount_eur: 250,
    enabled: 0,
    notes: 'Optional. Enable and set your dispatcher quote if you use one.',
  },
];

export const SEED_ACTIVE_SETTINGS = [
  { key: 'transport.active_method', value: 'transport.open_carrier' },
];
