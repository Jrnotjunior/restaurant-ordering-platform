import { describe, expect, it } from 'vitest';
import { calculatePayrollLine } from '../src/modules/payroll/payrollTypes';

describe('payroll calculations', () => {
  it('keeps the full agreed monthly base salary and applies explicit deductions', () => {
    expect(calculatePayrollLine('monthly', 18000, 20, 500, 1000)).toEqual({
      baseEarnings: 18000, additionalEarnings: 500, deductions: 1000, grossPay: 18500, netPay: 17500,
    });
  });

  it('calculates daily-paid earnings from days worked', () => {
    expect(calculatePayrollLine('daily', 610, 22, 300, 100)).toEqual({
      baseEarnings: 13420, additionalEarnings: 300, deductions: 100, grossPay: 13720, netPay: 13620,
    });
  });

  it('rejects deductions that exceed gross pay', () => {
    expect(() => calculatePayrollLine('daily', 500, 1, 0, 501)).toThrow('Deductions cannot exceed gross pay.');
  });

  it('rejects invalid salary rates and negative days', () => {
    expect(() => calculatePayrollLine('monthly', 0, 20, 0, 0)).toThrow('Salary rate must be greater than zero.');
    expect(() => calculatePayrollLine('daily', 500, -1, 0, 0)).toThrow('Days, earnings, and deductions must be non-negative.');
  });
});
