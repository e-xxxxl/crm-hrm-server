/**
 * Nigerian payroll statutory calculations — PAYE (Personal Income Tax) and
 * pension. Figures follow the Personal Income Tax Act as amended by the Finance
 * Acts (consolidated relief allowance + graduated bands, low-income exemption,
 * minimum tax).
 *
 * All helpers work in Naira. Callers pass ANNUAL figures to computePAYE and
 * divide the result by 12 for a monthly run.
 */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Graduated annual tax bands: [bandWidth, rate]. Last band is open-ended. */
const BANDS = [
  [300_000, 0.07],
  [300_000, 0.11],
  [500_000, 0.15],
  [500_000, 0.19],
  [1_600_000, 0.21],
  [Infinity, 0.24],
];

/**
 * Consolidated Relief Allowance: higher of ₦200,000 or 1% of gross income,
 * plus 20% of gross income.
 */
export function consolidatedReliefAllowance(grossAnnual) {
  const onePercentOrFloor = Math.max(200_000, 0.01 * grossAnnual);
  return round2(onePercentOrFloor + 0.2 * grossAnnual);
}

/**
 * @param grossAnnual        total annual taxable emoluments
 * @param pensionAnnual      employee pension contribution (tax-deductible)
 * @param nhfAnnual          National Housing Fund contribution (tax-deductible)
 * @param otherReliefsAnnual any additional statutory reliefs (life assurance…)
 * @returns { taxableIncome, annualTax, monthlyTax, effectiveRate, breakdown, cra, minimumTaxApplied }
 */
export function computePAYE(grossAnnual, { pensionAnnual = 0, nhfAnnual = 0, otherReliefsAnnual = 0 } = {}) {
  const gross = Math.max(0, grossAnnual);

  // Low-income exemption: annual gross at or below the national minimum wage
  // threshold pays no PAYE (Finance Act 2020, ₦300,000/yr).
  if (gross <= 300_000) {
    return {
      grossAnnual: round2(gross),
      cra: 0,
      taxableIncome: 0,
      annualTax: 0,
      monthlyTax: 0,
      effectiveRate: 0,
      minimumTaxApplied: false,
      breakdown: [],
    };
  }

  const cra = consolidatedReliefAllowance(gross);
  const reliefs = cra + pensionAnnual + nhfAnnual + otherReliefsAnnual;
  const taxableIncome = Math.max(0, round2(gross - reliefs));

  let remaining = taxableIncome;
  let annualTax = 0;
  const breakdown = [];
  for (const [width, rate] of BANDS) {
    if (remaining <= 0) break;
    const slice = Math.min(remaining, width);
    const tax = slice * rate;
    breakdown.push({ amount: round2(slice), rate, tax: round2(tax) });
    annualTax += tax;
    remaining -= slice;
  }
  annualTax = round2(annualTax);

  // Minimum tax: 1% of gross income where the graduated tax would be lower
  // (applies mainly when reliefs wipe out taxable income).
  const minimumTax = round2(0.01 * gross);
  let minimumTaxApplied = false;
  if (annualTax < minimumTax) {
    annualTax = minimumTax;
    minimumTaxApplied = true;
  }

  return {
    grossAnnual: round2(gross),
    cra,
    taxableIncome,
    annualTax,
    monthlyTax: round2(annualTax / 12),
    effectiveRate: gross > 0 ? round2((annualTax / gross) * 100) : 0,
    minimumTaxApplied,
    breakdown,
  };
}

/**
 * Contributory Pension Scheme. Employee 8%, employer 10% of the pensionable
 * base (basic + housing + transport). Only the employee share is deducted from
 * net pay; the employer share is reported for remittance.
 */
export function computePension(pensionableMonthly, { employeeRate = 0.08, employerRate = 0.1 } = {}) {
  const base = Math.max(0, pensionableMonthly);
  return {
    pensionableBase: round2(base),
    employee: round2(base * employeeRate),
    employer: round2(base * employerRate),
    total: round2(base * (employeeRate + employerRate)),
  };
}

/** National Housing Fund — 2.5% of basic salary (optional per employee). */
export function computeNHF(basicMonthly) {
  return round2(Math.max(0, basicMonthly) * 0.025);
}

export const roundMoney = round2;

export default { consolidatedReliefAllowance, computePAYE, computePension, computeNHF, roundMoney };
