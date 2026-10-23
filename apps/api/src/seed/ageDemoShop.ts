import { readFileSync } from 'node:fs';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../core/logger';
import {
  GoodsReceipt,
  Invoice,
  Payment,
  PurchaseOrder,
  Quotation,
  SalesReturn,
  SupplierPayment,
} from '../db/models';
import { runOverdueSweep } from '../jobs/overdueSweep';

/**
 * DEMO ONLY: spread a freshly built demo shop over the past couple of months.
 *
 * The demo builder (`scripts/demo-owner.mjs`) makes every document through the real
 * API, and the API stamps documents with "now", so a shop that has just been built
 * has no history: nothing is overdue, the sales chart is a single bar and the
 * ageing report is one column. This moves the dates of existing documents back, as
 * if the shop had been trading for weeks, then runs the overdue sweep so the
 * notifications the product would have raised along the way exist.
 *
 * It changes dates only - no amount, quantity or status - and keeps each bill's
 * payments and returns after the bill. It is a stand-in for time passing, so use
 * it on demo data and nowhere else.
 *
 *   npm run demo:age --workspace @shopos/api
 *
 * Reads the shop's id from demo/credentials.json (written by the demo builder).
 */

const DAY_MS = 86_400_000;
const NOW = Date.now();
const daysAgo = (days: number, from = NOW) => new Date(from - days * DAY_MS);

/** How long ago each invoice, in the order created, was raised. Deliberately uneven; 0 leaves it dated today. */
const INVOICE_AGES = [0, 0, 40, 9, 31, 5, 25, 14, 19, 1, 47, 7, 22, 2, 12, 34, 4, 29, 6, 17, 10, 8, 20, 11, 15, 13, 36, 26];

async function main(): Promise<void> {
  const credentials = JSON.parse(readFileSync(new URL('../../../../demo/credentials.json', import.meta.url), 'utf8'));
  const organizationId = new Types.ObjectId(credentials.organizationId as string);
  await connectDatabase();

  const invoices = await Invoice.find({ organizationId }).sort({ createdAt: 1 }).lean();
  const invoiceDateById = new Map<string, Date>();

  let index = 0;
  for (const invoice of invoices) {
    const age = INVOICE_AGES[index % INVOICE_AGES.length]!;
    index += 1;
    const shiftMs = age * DAY_MS - (NOW - new Date(invoice.invoiceDate).getTime());
    const invoiceDate = new Date(new Date(invoice.invoiceDate).getTime() - Math.max(shiftMs, 0));
    invoiceDateById.set(String(invoice._id), invoiceDate);
    await Invoice.updateOne(
      { organizationId, _id: invoice._id },
      {
        $set: {
          invoiceDate,
          dueDate: new Date(new Date(invoice.dueDate).getTime() - Math.max(shiftMs, 0)),
        },
      },
    );
  }

  const payments = await Payment.find({ organizationId }).lean();
  for (const payment of payments) {
    const dates = payment.allocations
      .map((allocation) => invoiceDateById.get(String(allocation.invoiceId))?.getTime())
      .filter((value): value is number => value !== undefined);
    const latestBill = dates.length > 0 ? Math.max(...dates) : NOW;
    await Payment.updateOne(
      { organizationId, _id: payment._id },
      { $set: { paymentDate: new Date(Math.min(NOW, latestBill + 2 * DAY_MS)) } },
    );
  }

  const returns = await SalesReturn.find({ organizationId }).lean();
  for (const sale of returns) {
    const billDate = invoiceDateById.get(String(sale.invoiceId))?.getTime() ?? NOW;
    await SalesReturn.updateOne(
      { organizationId, _id: sale._id },
      { $set: { returnDate: new Date(Math.min(NOW, billDate + 4 * DAY_MS)) } },
    );
  }

  // Purchases: each order gets an age, its receipts and payments follow it.
  const orders = await PurchaseOrder.find({ organizationId }).sort({ createdAt: 1 }).lean();
  const orderAges = [44, 28, 4, 36, 2, 40];
  const orderDateById = new Map<string, number>();
  let orderIndex = 0;
  for (const order of orders) {
    const age = orderAges[orderIndex % orderAges.length]!;
    orderIndex += 1;
    const shiftMs = Math.max(age * DAY_MS - (NOW - new Date(order.orderDate).getTime()), 0);
    orderDateById.set(String(order._id), NOW - age * DAY_MS);
    await PurchaseOrder.updateOne(
      { organizationId, _id: order._id },
      {
        $set: {
          orderDate: new Date(new Date(order.orderDate).getTime() - shiftMs),
          ...(order.dueDate ? { dueDate: new Date(new Date(order.dueDate).getTime() - shiftMs) } : {}),
        },
      },
    );
  }
  for (const receipt of await GoodsReceipt.find({ organizationId }).lean()) {
    const ordered = orderDateById.get(String(receipt.purchaseOrderId)) ?? NOW;
    await GoodsReceipt.updateOne(
      { organizationId, _id: receipt._id },
      { $set: { receivedDate: new Date(Math.min(NOW, ordered + 3 * DAY_MS)) } },
    );
  }
  for (const payment of await SupplierPayment.find({ organizationId }).lean()) {
    const firstOrder = payment.allocations[0]?.purchaseOrderId;
    const ordered = firstOrder ? orderDateById.get(String(firstOrder)) ?? NOW : NOW;
    await SupplierPayment.updateOne(
      { organizationId, _id: payment._id },
      { $set: { paymentDate: new Date(Math.min(NOW, ordered + 6 * DAY_MS)) } },
    );
  }

  // A quotation about to lapse, so the "expiring soon" alert has something to say.
  const draftQuote = await Quotation.findOne({ organizationId, status: 'DRAFT' }).sort({ createdAt: -1 }).lean();
  if (draftQuote) {
    await Quotation.updateOne(
      { organizationId, _id: draftQuote._id },
      { $set: { quotationDate: daysAgo(12), validUntil: new Date(NOW + 2 * DAY_MS) } },
    );
  }

  const notifications = await runOverdueSweep();
  logger.info(
    { invoices: invoices.length, payments: payments.length, returns: returns.length, orders: orders.length, notifications },
    'Demo shop dates spread over the past weeks',
  );
  await disconnectDatabase();
}

main().catch(async (error) => {
  logger.fatal({ err: error }, 'Could not age the demo shop');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
