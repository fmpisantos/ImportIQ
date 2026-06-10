// Static brand → popular-models map for the filter dropdowns in `apify` mode.
// The scrapers accept free-text make/model, so this list only needs to cover
// the common cases users pick from; brand/model can also be typed directly.

export const POPULAR_BRANDS = {
  Audi: ['A1', 'A3', 'A4', 'A4 Avant', 'A6', 'Q3', 'Q5'],
  BMW: ['1 Series', '2 Series', '3 Series', '320i', '4 Series', '5 Series', 'X1', 'X3'],
  'Mercedes-Benz': ['A-Class', 'C-Class', 'C 300 e', 'E-Class', 'GLA', 'GLC'],
  Volkswagen: ['Golf', 'Polo', 'Passat', 'Tiguan', 'T-Roc', 'ID.3', 'ID.4'],
  Volvo: ['V40', 'V60', 'XC40', 'XC60', 'XC90'],
  Toyota: ['Yaris', 'Corolla', 'C-HR', 'RAV4'],
  Renault: ['Clio', 'Captur', 'Mégane', 'Zoe'],
  Peugeot: ['208', '308', '2008', '3008'],
  Ford: ['Fiesta', 'Focus', 'Puma', 'Kuga'],
  Tesla: ['Model 3', 'Model Y', 'Model S'],
  Skoda: ['Fabia', 'Octavia', 'Kamiq', 'Karoq'],
  SEAT: ['Ibiza', 'Leon', 'Arona', 'Ateca'],
};
