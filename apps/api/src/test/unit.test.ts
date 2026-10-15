import { describe, expect, it } from 'vitest';
import { movingAverageCost } from '../services/costingService';
import { buildStatement, type StatementEntry } from '../services/statementService';
import { neutraliseFormula, toCsv } from '../modules/reports/csv';
import type { ReportResult } from '../modules/reports/reportTypes';

/** Pure functions: no server, no database. */

describe('moving average cost', () => {
  it('weights what was on the shelf against what arrived', () => {
    expect(movingAverageCost({ onHandQty: 100, currentCostPaise: 300, receivedQty: 100, unitCostPaise: 500 })).toBe(400);
    expect(movingAverageCost({ onHandQty: 2350, currentCostPaise: 336, receivedQty: 100, unitCostPaise: 500 })).toBe(343);
  });

  it('takes the new price outright when nothing was on hand or no cost was known', () => {
    expect(movingAverageCost({ onHandQty: 0, currentCostPaise: 300, receivedQty: 10, unitCostPaise: 500 })).toBe(500);
    expect(movingAverageCost({ onHandQty: 50, currentCostPaise: undefined, receivedQty: 10, unitCostPaise: 500 })).toBe(500);
  });

  it('treats negative stock as nothing on hand rather than dragging the average', () => {
    expect(movingAverageCost({ onHandQty: -20, currentCostPaise: 300, receivedQty: 10, unitCostPaise: 500 })).toBe(500);
  });
});

describe('a spreadsheet cannot be made to run a formula', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tTAB'])('prefixes %j so it is read as text', (text) => {
    expect(neutraliseFormula(text)).toBe(`'${text}`);
  });

  it('leaves ordinary text alone', () => {
    expect(neutraliseFormula('Natraj Pencil')).toBe('Natraj Pencil');
    expect(neutraliseFormula('')).toBe('');
    expect(neutraliseFormula('a=b')).toBe('a=b');
  });
});

describe('CSV output', () => {
  const report: ReportResult = {
    key: 'test',
    title: 'Test',
    columns: [
      { key: 'label', label: 'Customer', type: 'text' },
      { key: 'amountPaise', label: 'Amount', type: 'money' },
      { key: 'share', label: 'Share', type: 'percent' },
    ],
    rows: [
      { label: 'Sharma, "Bhai" & Sons', amountPaise: 123450, share: 12.345 },
      { label: '=BAD()', amountPaise: 5, share: null },
    ],
    totals: { amountPaise: 123455 },
  };

  it('writes rupees, quotes awkward text, defuses formulas and totals the money column', () => {
    const lines = toCsv(report).replace(/^﻿/, '').trim().split('\r\n');

    expect(lines[0]).toBe('Customer,Amount,Share');
    expect(lines[1]).toBe('"Sharma, ""Bhai"" & Sons",1234.50,12.3');
    expect(lines[2]).toBe("'=BAD(),0.05,");
    expect(lines[3]).toBe('Total,1234.55,');
  });

  it('opens correctly in Excel, which needs a byte-order mark for Hindi names', () => {
    expect(toCsv(report).startsWith('﻿')).toBe(true);
  });
});

describe('statement of account', () => {
  const entry = (day: number, debit: number, credit: number, reference: string): StatementEntry => ({
    date: new Date(Date.UTC(2026, 9, day, 12)),
    type: 'X',
    reference,
    description: reference,
    debitPaise: debit,
    creditPaise: credit,
  });

  const entries = [entry(10, 0, 3000, 'C'), entry(1, 10000, 0, 'A'), entry(5, 2000, 0, 'B')];

  it('orders by date and runs the balance down the page', () => {
    const statement = buildStatement(entries, { to: new Date(Date.UTC(2026, 9, 31)) });

    expect(statement.entries.map((row) => row.reference)).toEqual(['A', 'B', 'C']);
    expect(statement.entries.map((row) => row.balancePaise)).toEqual([10000, 12000, 9000]);
    expect(statement.closingBalancePaise).toBe(9000);
    expect(statement.totalDebitPaise - statement.totalCreditPaise).toBe(9000);
  });

  it('carries what happened before the start in as the opening balance', () => {
    const statement = buildStatement(entries, {
      from: new Date(Date.UTC(2026, 9, 6)),
      to: new Date(Date.UTC(2026, 9, 31)),
    });

    expect(statement.openingBalancePaise).toBe(12000);
    expect(statement.entries.map((row) => row.reference)).toEqual(['C']);
    expect(statement.closingBalancePaise).toBe(9000);
  });

  it('leaves out anything after the end date', () => {
    const statement = buildStatement(entries, { to: new Date(Date.UTC(2026, 9, 4)) });
    expect(statement.entries.map((row) => row.reference)).toEqual(['A']);
    expect(statement.closingBalancePaise).toBe(10000);
  });
});
