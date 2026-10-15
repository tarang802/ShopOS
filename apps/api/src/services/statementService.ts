/**
 * Turning a pile of documents into a statement.
 *
 * A statement is the plain-language view an accountant or a customer asks for:
 * every bill, payment and credit in date order with a running balance. It is
 * built from the documents themselves, never from a stored balance, so it can
 * only ever agree with them.
 */

export interface StatementEntry {
  date: Date;
  type: string;
  /** The document number, e.g. INV-2026-000012. */
  reference: string;
  description: string;
  /** Increases what is owed. */
  debitPaise: number;
  /** Decreases what is owed. */
  creditPaise: number;
  link?: { type: string; id: string };
}

export interface Statement {
  from: Date | null;
  to: Date;
  /** The balance carried in from before `from`. */
  openingBalancePaise: number;
  entries: (StatementEntry & { balancePaise: number })[];
  closingBalancePaise: number;
  totalDebitPaise: number;
  totalCreditPaise: number;
}

/**
 * Order the entries, split off the opening balance and run the balance down the
 * page.
 *
 * `debit - credit` is the direction for a customer (what they owe us). A supplier
 * statement passes entries with the roles swapped, so the same arithmetic reads
 * as what we owe them.
 */
export function buildStatement(
  entries: StatementEntry[],
  range: { from?: Date | undefined; to: Date },
): Statement {
  const sorted = [...entries].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.reference.localeCompare(b.reference),
  );

  let opening = 0;
  const inRange: StatementEntry[] = [];
  for (const entry of sorted) {
    if (range.from && entry.date.getTime() < range.from.getTime()) {
      opening += entry.debitPaise - entry.creditPaise;
    } else if (entry.date.getTime() <= range.to.getTime()) {
      inRange.push(entry);
    }
  }

  let balance = opening;
  let totalDebit = 0;
  let totalCredit = 0;
  const withBalance = inRange.map((entry) => {
    balance += entry.debitPaise - entry.creditPaise;
    totalDebit += entry.debitPaise;
    totalCredit += entry.creditPaise;
    return { ...entry, balancePaise: balance };
  });

  return {
    from: range.from ?? null,
    to: range.to,
    openingBalancePaise: opening,
    entries: withBalance,
    closingBalancePaise: balance,
    totalDebitPaise: totalDebit,
    totalCreditPaise: totalCredit,
  };
}

/** The end of the chosen day, so a statement run "to the 15th" includes the 15th. */
export function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}
