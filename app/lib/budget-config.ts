// Client-safe budget constants — no server imports here.

import { CURRENT_CAR_YEAR } from './car-year';

// Subteam codes, in the order the finance charts show them.
export const SUBTEAM_CODES = ['AERO', 'CHS', 'SUS', 'BAT', 'ECE', 'PT', 'SW', 'DBMS', 'OPS', 'FACIL', 'FLEET', 'MKTG', 'VD'];

// Subteam budgets per car year. Add a season's budgets here when they are set;
// a car year with no entry is shown without budget limits and skips the budget check.
export const CAR_YEAR_BUDGETS: Record<string, Record<string, number>> = {
  AME27: {
    AERO: 6120,
    CHS: 5150,
    SUS: 19100,
    BAT: 19500,
    ECE: 11260,
    PT: 31200.99,
    SW: 800,
    DBMS: 3500,
    OPS: 29500,
    FACIL: 0,
    FLEET: 2000,
    MKTG: 1100,
    VD: 7250,
  },
};

export const SUBTEAM_BUDGETS: Record<string, number> = CAR_YEAR_BUDGETS[CURRENT_CAR_YEAR] ?? {};

// Email(s) authorized to approve overbudget orders.
export const PM_EMAILS = ['puravdatta@tamu.edu'];

export function normalizeSubteam(subteam: string): string {
  const normalized = subteam.toUpperCase();
  const mapping: Record<string, string> = {
    AERODYNAMICS: 'AERO',
    CHASSIS: 'CHS',
    SUSPENSION: 'SUS',
    BATTERY: 'BAT',
    ELECTRONICS: 'ECE',
    POWERTRAIN: 'PT',
    SOFTWARE: 'SW',
    'DISTRIBUTED BMS': 'DBMS',
    OPERATIONS: 'OPS',
    'FACILITIES/INFRASTRUCTURE': 'FACIL',
    'FLEET MAINTENANCE': 'FLEET',
    MARKETING: 'MKTG',
    'VEHICLE DYNAMICS': 'VD',
    VD: 'VD',
  };
  return mapping[normalized] || normalized;
}

export function isPM(email: string): boolean {
  return PM_EMAILS.includes(email.toLowerCase());
}
