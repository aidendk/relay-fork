import 'dotenv/config';
import { PrismaClient, Role, OrderStatus, ItemStatus } from '@prisma/client';
import 'dotenv/config';
const prisma = new PrismaClient();

// Season runs June to May and is named after the car: June 2026 – May 2027 is AME27.
const carYearFor = (d: Date) => `AME${(d.getUTCFullYear() % 100) + (d.getUTCMonth() >= 5 ? 1 : 0)}`;

async function main() {
  // Generate test orders before and after the AME27 budget start date.
  function getRandomDate() {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2026-12-31T23:59:59Z');
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  }

  // Subteams
  const subteams = ['AERO', 'CHS', 'SUS', 'BAT', 'ECE', 'PT'];

  // Vendors
  const vendors = ['Vendor A', 'Vendor B', 'Vendor C', 'Vendor D'];
  const seedRunId = Date.now();

  // Create Users
  const users = await Promise.all(
    subteams.map((subteam, index) =>
      prisma.user.upsert({
        where: { email: `user${index}@example.com` },
        update: {},
        create: {
          name: `User ${index}`,
          email: `user${index}@example.com`,
          phone: null,
          role: Role.ENGINEER,
          subteam: subteam,
          password: "abcd"
        },
      })
    )
  );

  // Generate orders across 2025 and 2026 for budget-period testing.
  for (let i = 0; i < 50; i++) {
    const user = users[Math.floor(Math.random() * users.length)];
    const vendor = vendors[Math.floor(Math.random() * vendors.length)];
    const totalCost = Math.floor(Math.random() * 5000) + 500; // Random cost between $500 and $5500
    const createdAt = getRandomDate();

    await prisma.order.create({
      data: {
        internalOrderId: `SEED-${seedRunId}-ORD-${i}`,
        name: `Order ${i}`,
        userId: user.id,
        subteam: user.subteam,
        status: OrderStatus.ARCHIVED,
        vendor: vendor,
        totalCost: totalCost,
        comments: `Order ${i} comments`,
        costBreakdown: {
          [user.subteam]: 100,
        },
        createdAt: createdAt,
        carYear: carYearFor(createdAt),
        items: {
          create: [
            {
              internalItemId: `SEED-${seedRunId}-ITEM-${i}`,
              name: `Item ${i}`,
              partNumber: `PN-${i}`,
              notes: `Notes for item ${i}`,
              quantity: Math.floor(Math.random() * 10) + 1,
              price: totalCost,
              vendor: vendor,
              status: ItemStatus.TO_ORDER,
            },
          ],
        },
      },
    });
  }

  console.log('Database has been seeded with orders across time. 🌱');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
