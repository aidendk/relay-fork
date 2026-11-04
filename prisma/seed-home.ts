// Seeds active (non-archived) orders across every subteam so the home page
// order table and its subteam filter have something to show.
// Safe to re-run: removes orders from earlier runs (SEED-HOME- prefix) first.
// Run with: node prisma/seed-home.ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const PREFIX = 'SEED-HOME-';

// Full subteam name -> cost breakdown code (matches normalizeSubteam in app/lib/budget-config.ts)
const SUBTEAMS: Record<string, { code: string; role: 'ENGINEER' | 'BUSINESS' }> = {
  AERODYNAMICS: { code: 'AERO', role: 'ENGINEER' },
  BATTERY: { code: 'BAT', role: 'ENGINEER' },
  CHASSIS: { code: 'CHS', role: 'ENGINEER' },
  ELECTRONICS: { code: 'ECE', role: 'ENGINEER' },
  POWERTRAIN: { code: 'PT', role: 'ENGINEER' },
  SUSPENSION: { code: 'SUS', role: 'ENGINEER' },
  'DISTRIBUTED BMS': { code: 'DBMS', role: 'ENGINEER' },
  SOFTWARE: { code: 'SW', role: 'ENGINEER' },
  'VEHICLE DYNAMICS': { code: 'VD', role: 'ENGINEER' },
  FINANCE: { code: 'FINANCE', role: 'BUSINESS' },
  OPERATIONS: { code: 'OPS', role: 'BUSINESS' },
  MARKETING: { code: 'MKTG', role: 'BUSINESS' },
};

const PARTS: Record<string, string[]> = {
  AERODYNAMICS: ['Carbon Fiber Sheet', 'Wing Endplate Rivets', 'Detent Pins', 'Foam Core Block'],
  BATTERY: ['Cell Holders', 'Nickel Strip Roll', 'Busbar Copper', 'Fish Paper Insulation'],
  CHASSIS: ['4130 Steel Tube', 'Tab Stock', 'Rod Ends', 'TIG Filler Rod'],
  ELECTRONICS: ['Molex Connectors', 'Shielded Wire 22AWG', 'Heat Shrink Kit', 'PCB Fabrication'],
  POWERTRAIN: ['Chain and Sprocket', 'Motor Mount Bolts', 'Coolant Hose', 'Bearing Set'],
  SUSPENSION: ['Damper Rebuild Kit', 'Spherical Bearings', 'Pushrod Tubing', 'Clevis Pins'],
  'DISTRIBUTED BMS': ['Isolated ADC Boards', 'Thermistor Pack', 'CAN Transceivers'],
  SOFTWARE: ['Raspberry Pi 5', 'MicroSD Cards', 'USB CAN Adapter'],
  'VEHICLE DYNAMICS': ['Linear Potentiometers', 'IMU Module', 'Wheel Speed Sensors'],
  FINANCE: ['Receipt Printer Paper', 'Binder Clips'],
  OPERATIONS: ['Shop Rags', 'Zip Ties Bulk', 'Safety Glasses'],
  MARKETING: ['Team Stickers', 'Banner Print', 'Polo Shirts'],
};

const VENDORS = ['McMaster', 'Digikey', 'Amazon', 'Mouser', 'Summit Racing', 'Ebay', 'JLCPCB'];

// Statuses the home page shows (it hides ARCHIVED, EV_ARCHIVED and AWAITING_APPROVAL)
const STATUSES = [
  'TO_ORDER', 'PLACED', 'MEEN_RECEIVED', 'MEEN_PLACED', 'MEEN_HOLD', 'PROCESSED',
  'SUPPLIER_SHIPPED', 'SHIPPED', 'AWAITING_PICKUP', 'EV_AWAITING_PICKUP', 'PARTIAL_DELIVERY', 'DELIVERED',
] as const;

const SHIPPED_STATUSES = new Set(['SUPPLIER_SHIPPED', 'SHIPPED', 'AWAITING_PICKUP', 'EV_AWAITING_PICKUP', 'PARTIAL_DELIVERY', 'DELIVERED']);
const DELIVERY_LOCATIONS = ['Instrumentation', 'USB', 'Thompson'];

// Deterministic PRNG so re-runs produce the same data
let state = 42;
function rand() {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
}
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];

function slug(subteam: string) {
  return subteam.toLowerCase().replace(/[^a-z]+/g, '-');
}

async function main() {
  const password = await bcrypt.hash('password123', 12);

  const removed = await prisma.order.deleteMany({ where: { internalOrderId: { startsWith: PREFIX } } });
  if (removed.count) console.log(`Removed ${removed.count} orders from a previous run`);

  const users = await Promise.all(
    Object.entries(SUBTEAMS).map(([subteam, { role }]) =>
      prisma.user.upsert({
        where: { email: `seed-${slug(subteam)}@example.com` },
        update: { subteam, role, password },
        create: {
          name: `Test ${subteam.charAt(0)}${subteam.slice(1).toLowerCase()}`,
          email: `seed-${slug(subteam)}@example.com`,
          role,
          subteam,
          password,
        },
      })
    )
  );

  let count = 0;
  for (const user of users) {
    const orderCount = 2 + Math.floor(rand() * 3); // 2-4 orders per subteam
    for (let n = 0; n < orderCount; n++) {
      const status = pick(STATUSES);
      const vendor = pick(VENDORS);
      const partName = pick(PARTS[user.subteam]);
      const quantity = 1 + Math.floor(rand() * 10);
      const unitPrice = Math.round((5 + rand() * 300) * 100) / 100;
      const totalCost = Math.round(quantity * unitPrice * 100) / 100;
      const createdAt = new Date(Date.now() - Math.floor(rand() * 60) * 24 * 60 * 60 * 1000);
      const hasMeenId = status !== 'TO_ORDER' && status !== 'PLACED';
      const shipped = SHIPPED_STATUSES.has(status);

      await prisma.order.create({
        data: {
          internalOrderId: `${PREFIX}${count}`,
          meenOrderId: hasMeenId ? String(8000 + count) : null,
          name: partName,
          userId: user.id,
          subteam: user.subteam,
          status,
          vendor,
          totalCost,
          comments: rand() < 0.4 ? `Need ${quantity} for the next build` : null,
          url: `https://example.com/${slug(partName)}`,
          carrier: shipped ? pick(['UPS', 'FedEx', 'USPS']) : '',
          trackingId: shipped ? `1Z${Math.floor(rand() * 1e10)}` : '',
          costBreakdown: { [SUBTEAMS[user.subteam].code]: 100 },
          deliveryLocation: pick(DELIVERY_LOCATIONS),
          createdAt,
          items: {
            create: [
              {
                internalItemId: `${PREFIX}ITEM-${count}`,
                name: partName,
                partNumber: `PN-${1000 + count}`,
                quantity,
                price: unitPrice,
                vendor,
                status: shipped ? 'SHIPPED' : 'TO_ORDER',
              },
            ],
          },
        },
      });
      count++;
    }
  }

  console.log(`Seeded ${users.length} users and ${count} active orders.`);
  console.log('Test logins: seed-<subteam>@example.com / password123 (e.g. seed-aerodynamics@example.com)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
