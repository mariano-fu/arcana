import type { Payment } from '../../db';
import { buildPaymentsCsv, csvCell, formatCsvAmount, type PaymentsCsvLabels } from './csv';

const labels: PaymentsCsvLabels = {
  headers: ['Fecha', 'Cliente', 'Monto', 'Moneda', 'Método', 'Referencia', 'Nota'],
  method: {
    sinpe: 'SINPE Móvil',
    cash: 'Efectivo',
    transfer: 'Transferencia',
    paypal: 'PayPal',
    other: 'Otro',
  },
  unknownClient: '(cliente eliminado)',
};

function payment(id: string, overrides: Partial<Payment> = {}): Payment {
  return {
    id,
    session_id: 's1',
    client_id: 'c1',
    amount_minor: 1_500_000,
    currency: 'CRC',
    method: 'sinpe',
    paid_at: '2026-10-10',
    reference: null,
    note: '',
    updated_at: '2026-10-10T15:00:00.000Z',
    deleted_at: null,
    server_version: null,
    device_id: 'd1',
    pending: 1,
    ...overrides,
  };
}

describe('formatCsvAmount', () => {
  it('writes minor units with a decimal comma, no symbol and no grouping', () => {
    expect(formatCsvAmount(1_500_000)).toBe('15000,00');
    expect(formatCsvAmount(4_050)).toBe('40,50');
    expect(formatCsvAmount(5)).toBe('0,05');
    expect(formatCsvAmount(0)).toBe('0,00');
    expect(formatCsvAmount(-1_050)).toBe('-10,50');
  });

  it('rejects non-integer amounts', () => {
    expect(() => formatCsvAmount(10.5)).toThrow(RangeError);
  });
});

describe('csvCell', () => {
  it('leaves plain text alone', () => {
    expect(csvCell('María José')).toBe('María José');
  });

  it('quotes separators, quotes and line breaks', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(csvCell('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"');
  });

  it('defuses spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+50688887777')).toBe("'+50688887777");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
});

describe('buildPaymentsCsv', () => {
  const names = new Map([
    ['c1', 'Cliente Uno'],
    ['c2', 'Cliente; Dos'],
  ]);

  it('writes a BOM, a header and one row per payment, oldest first, CRLF line endings', () => {
    const csv = buildPaymentsCsv(
      [
        payment('p2', {
          paid_at: '2026-10-20',
          client_id: 'c2',
          amount_minor: 4_050,
          currency: 'USD',
          method: 'paypal',
          reference: 'ABC123',
          note: 'Seña',
        }),
        payment('p1', { paid_at: '2026-10-05' }),
      ],
      names,
      labels,
    );

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Fecha;Cliente;Monto;Moneda;Método;Referencia;Nota',
      '2026-10-05;Cliente Uno;15000,00;CRC;SINPE Móvil;;',
      '2026-10-20;"Cliente; Dos";40,50;USD;PayPal;ABC123;Seña',
      '',
    ]);
  });

  it('names a missing client instead of leaving the cell blank', () => {
    const csv = buildPaymentsCsv([payment('p1', { client_id: 'gone' })], names, labels);
    expect(csv).toContain(';(cliente eliminado);');
  });

  it('is just the header for a month without payments', () => {
    expect(buildPaymentsCsv([], names, labels)).toBe(
      '\uFEFFFecha;Cliente;Monto;Moneda;Método;Referencia;Nota\r\n',
    );
  });
});
