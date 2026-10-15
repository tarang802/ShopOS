import { useOrganization } from '@/hooks/useOrganization';

/**
 * The letterhead and footer of anything printed: who is billing, how to reach them,
 * and what they want said at the bottom. Invisible on screen; the page chrome is
 * hidden when printing, so this is what makes a printout look like a document.
 */

export function PrintHeader({ title }: { title: string }) {
  const { data: org } = useOrganization();
  if (!org) return null;

  const place = [org.addressLine, org.city, org.state, org.pincode].filter(Boolean).join(', ');

  return (
    <div className="print-only mb-6 border-b border-black pb-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xl font-bold">{org.name}</p>
          {place && <p className="text-sm">{place}</p>}
          <p className="text-sm">
            {[org.phone && `Phone ${org.phone}`, org.email, org.gstin && `GSTIN ${org.gstin}`]
              .filter(Boolean)
              .join('  |  ')}
          </p>
        </div>
        <p className="text-lg font-semibold uppercase tracking-wide">{title}</p>
      </div>
    </div>
  );
}

export function PrintFooter() {
  const { data: org } = useOrganization();
  const footer = org?.settings.invoiceFooter;
  const payment = org?.settings.paymentInstructions;
  if (!footer && !payment) return null;

  return (
    <div className="print-only mt-8 border-t border-black pt-3 text-sm">
      {payment && (
        <p className="mb-1">
          <span className="font-semibold">How to pay: </span>
          {payment}
        </p>
      )}
      {footer && <p>{footer}</p>}
    </div>
  );
}
