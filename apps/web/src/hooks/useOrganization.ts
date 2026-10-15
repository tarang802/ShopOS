import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';

export interface Organization {
  _id: string;
  name: string;
  businessType?: string;
  gstin?: string;
  phone?: string;
  email?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
  currency: string;
  settings: {
    allowNegativeStock: boolean;
    lowStockThreshold: number;
    maxDiscountPercent?: number;
    enforceCreditLimit?: boolean;
    invoiceFooter?: string;
    paymentInstructions?: string;
  };
}

/** The business the signed-in person works for: what goes at the top of a printed bill. */
export function useOrganization() {
  return useQuery({
    queryKey: ['organization'],
    queryFn: () => api.get<Organization>('/organizations/current'),
    staleTime: 5 * 60_000,
  });
}
