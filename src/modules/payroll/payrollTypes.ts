export type SalaryBasis='monthly'|'daily'; export type ShiftStatus='scheduled'|'completed'|'absent'|'cancelled';
export type SalaryProfile={id:string;restaurant_id:string;employee_id:string;salary_basis:'daily';salary_rate:number;effective_from:string;notes:string};
export type EmployeeShift={id:string;restaurant_id:string;employee_id:string;shift_date:string;starts_at:string;ends_at:string;break_minutes:number;status:ShiftStatus;notes:string};
export type PayrollRun={id:string;restaurant_id:string;period_start:string;period_end:string;status:'draft'|'finalized'|'paid';total_gross:number;total_deductions:number;total_net:number;payment_date:string|null;payment_method:string;created_at:string};
export type PayrollItem={id:string;payroll_run_id:string;employee_id:string;employee_name_snapshot:string;employee_role_snapshot:string;salary_basis_snapshot:SalaryBasis;salary_rate_snapshot:number;days_worked:number;base_earnings:number;additional_earnings:number;deductions:number;gross_pay:number;net_pay:number;adjustment_note:string};

export function calculatePayrollLine(basis: SalaryBasis, rate: number, days: number, extra: number, deductions: number): {baseEarnings:number;additionalEarnings:number;deductions:number;grossPay:number;netPay:number};
export function calculatePayrollLine(rate: number, days: number, extra: number, deductions: number): {baseEarnings:number;additionalEarnings:number;deductions:number;grossPay:number;netPay:number};
export function calculatePayrollLine(basisOrRate: SalaryBasis | number, rateOrDays: number, daysOrExtra: number, extraOrDeductions: number, maybeDeductions?: number) {
  const hasBasis = typeof basisOrRate === 'string';
  const basis: SalaryBasis = hasBasis ? basisOrRate : 'daily';
  const rate = hasBasis ? rateOrDays : basisOrRate;
  const days = hasBasis ? daysOrExtra : rateOrDays;
  const extra = hasBasis ? extraOrDeductions : daysOrExtra;
  const deductions = hasBasis ? (maybeDeductions as number) : extraOrDeductions;

  if (!Number.isFinite(days) || days < 0 || !Number.isFinite(extra) || extra < 0 || !Number.isFinite(deductions) || deductions < 0) {
    throw new Error('Days, earnings, and deductions must be non-negative.');
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Salary rate must be greater than zero.');
  }
  const base = Math.round((basis === 'monthly' ? rate : rate * days) * 100) / 100;
  const additionalEarnings = Math.round(extra * 100) / 100;
  const normalizedDeductions = Math.round(deductions * 100) / 100;
  const gross = Math.round((base + additionalEarnings) * 100) / 100;
  if (normalizedDeductions > gross) throw new Error('Deductions cannot exceed gross pay.');
  return { baseEarnings: base, additionalEarnings, deductions: normalizedDeductions, grossPay: gross, netPay: Math.round((gross - normalizedDeductions) * 100) / 100 };
}
