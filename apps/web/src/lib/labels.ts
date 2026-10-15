/**
 * Bilingual labels.
 *
 * WHY: ShopOS is used by shop owners, counter staff and godown staff across
 * India. Many read English comfortably; many read Hindi faster; most think in
 * the trade words they use every day - maal, bhav, godown, party. A screen that
 * insists on formal ERP English ("Stock Keeping Unit", "Price List Entity")
 * makes them slower and less confident.
 *
 * The approach is English first, with the familiar word underneath in smaller
 * type. It stays readable for a Hindi speaker, an English speaker, and a
 * regional-language speaker who recognises the trade term either way - without
 * forcing anyone to pick a language before they can use the software.
 *
 * Terminology follows the trade, not the textbook:
 *   Rate    not Price      - "aaj ka bhav kya hai"
 *   Slab    not Tier       - how quantity pricing is actually described
 *   Item    not SKU        - the item code is what is called out at a counter
 *   Godown  alongside Branch - where stock actually sits
 */

export interface Label {
  en: string;
  hi: string;
}

export const LABELS = {
  // Navigation
  dashboard: { en: 'Dashboard', hi: 'डैशबोर्ड' },
  products: { en: 'Products', hi: 'सामान' },
  rates: { en: 'Rates', hi: 'भाव' },
  stock: { en: 'Stock', hi: 'स्टॉक' },
  transfers: { en: 'Transfers', hi: 'ट्रांसफर' },
  movements: { en: 'Stock History', hi: 'स्टॉक हिसाब' },
  branches: { en: 'Branches', hi: 'शाखा / गोदाम' },
  staff: { en: 'Staff', hi: 'स्टाफ' },
  roles: { en: 'Roles', hi: 'अधिकार' },
  settings: { en: 'Settings', hi: 'सेटिंग' },
  auditLog: { en: 'Activity Log', hi: 'गतिविधि' },
  customers: { en: 'Customers', hi: 'ग्राहक' },
  sales: { en: 'Sales', hi: 'बिक्री' },
  quotations: { en: 'Quotations', hi: 'कोटेशन' },
  salesOrders: { en: 'Sales Orders', hi: 'बिक्री ऑर्डर' },
  suppliers: { en: 'Suppliers', hi: 'सप्लायर' },
  purchases: { en: 'Purchase Orders', hi: 'खरीद ऑर्डर' },
  payments: { en: 'Payments', hi: 'भुगतान' },

  // Common actions
  search: { en: 'Search', hi: 'खोजें' },
  add: { en: 'Add', hi: 'जोड़ें' },
  save: { en: 'Save', hi: 'सेव करें' },
  cancel: { en: 'Cancel', hi: 'रद्द करें' },
  edit: { en: 'Edit', hi: 'बदलें' },

  // Business words
  retail: { en: 'Retail', hi: 'खुदरा' },
  wholesale: { en: 'Wholesale', hi: 'थोक' },
  dealer: { en: 'Dealer', hi: 'डीलर' },
  quantity: { en: 'Quantity', hi: 'मात्रा' },
  rate: { en: 'Rate', hi: 'भाव' },
  itemCode: { en: 'Item Code', hi: 'आइटम कोड' },
  brand: { en: 'Brand', hi: 'ब्रांड' },
  category: { en: 'Category', hi: 'श्रेणी' },
  unit: { en: 'Unit', hi: 'यूनिट' },
  lowStock: { en: 'Low Stock', hi: 'स्टॉक कम' },
  total: { en: 'Total', hi: 'कुल' },
} as const satisfies Record<string, Label>;

export type LabelKey = keyof typeof LABELS;

/**
 * Rate lists seeded by ShopOS get a familiar second line. A rate list the owner
 * invented themselves has no translation, and simply shows its own name - which
 * is right, because they named it in the words they use.
 */
const PRICE_LIST_HINDI: Record<string, string> = {
  RETAIL: 'खुदरा भाव',
  WHOLESALE: 'थोक भाव',
  DEALER: 'डीलर भाव',
};

export function priceListSubtitle(code: string): string | undefined {
  return PRICE_LIST_HINDI[code.toUpperCase()];
}

/** Plain-language wording for stock movement types. */
export const MOVEMENT_LABELS: Record<string, Label> = {
  OPENING_STOCK: { en: 'Opening stock', hi: 'शुरुआती स्टॉक' },
  PURCHASE: { en: 'Purchase received', hi: 'खरीद' },
  SALE: { en: 'Sold', hi: 'बिक्री' },
  SALE_RETURN: { en: 'Sales return', hi: 'बिक्री वापसी' },
  PURCHASE_RETURN: { en: 'Returned to supplier', hi: 'सप्लायर वापसी' },
  DAMAGE: { en: 'Damaged', hi: 'खराब' },
  ADJUSTMENT: { en: 'Adjusted', hi: 'सुधार' },
  TRANSFER_OUT: { en: 'Sent out', hi: 'भेजा' },
  TRANSFER_IN: { en: 'Received in', hi: 'आया' },
};

/** Why a stock figure was corrected. Shown in the adjustment form. */
export const ADJUSTMENT_REASON_LABELS: Record<string, Label> = {
  PHYSICAL_COUNT: { en: 'Physical count', hi: 'गिनती' },
  DAMAGE: { en: 'Damaged goods', hi: 'माल खराब' },
  THEFT: { en: 'Theft or loss', hi: 'चोरी / नुकसान' },
  EXPIRY: { en: 'Expired', hi: 'एक्सपायर' },
  SAMPLE: { en: 'Given as sample', hi: 'सैंपल' },
  DATA_ENTRY_ERROR: { en: 'Entry mistake', hi: 'एंट्री गलती' },
  OTHER: { en: 'Other', hi: 'अन्य' },
};
