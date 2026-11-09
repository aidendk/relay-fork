export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../lib/prisma';
import { normalizeSubteam } from '../../lib/budget-config';
import { ItemStatus, OrderStatus, Prisma } from '@prisma/client';

const PAGE_SIZE = 15;

// An order belongs to the subteams it is charged to (its cost breakdown, keyed by
// short code like AERO), not to the subteam of whoever placed it. Orders with no
// breakdown fall back to the placer's subteam, stored as either the full name or the code.
function subteamWhere(subteam: string): Prisma.OrderWhereInput {
    const code = normalizeSubteam(subteam);
    const names = Array.from(new Set([subteam, code]));
    return {
        OR: [
            { costBreakdown: { path: [code], gt: 0 } },
            {
                costBreakdown: { equals: Prisma.AnyNull },
                OR: names.map((name) => ({ subteam: { equals: name, mode: 'insensitive' as const } })),
            },
        ],
    };
}

const orderSelect = {
    id: true,
    internalOrderId: true,
    meenOrderId: true,
    name: true,
    userId: true,
    subteam: true,
    status: true,
    vendor: true,
    totalCost: true,
    costVerified: true,
    comments: true,
    url: true,
    carrier: true,
    trackingId: true,
    costBreakdown: true,
    createdAt: true,
    updatedAt: true,
    deliveryLocation: true,
    deliveryPhotoUrl: true,
    carYear: true,
    trouble: true,
    user: {
        select: {
            id: true,
            name: true,
            email: true,
            subteam: true,
            role: true,
        },
    },
    items: {
        select: {
            id: true,
            internalItemId: true,
            internalSKU: true,
            orderId: true,
            name: true,
            partNumber: true,
            notes: true,
            quantity: true,
            price: true,
            priceVerified: true,
            vendor: true,
            vendorSKU: true,
            link: true,
            status: true,
            location: true,
            level: true,
            createdAt: true,
            updatedAt: true,
            deliveryPhotoUrl: true,
        },
    },
} satisfies Prisma.OrderSelect;

function serialize(orders: Prisma.OrderGetPayload<{ select: typeof orderSelect }>[]) {
    return orders.map((order) => ({
        ...order,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        user: { ...order.user, createdAt: '', updatedAt: '' },
        items: order.items.map((item) => ({
            ...item,
            createdAt: item.createdAt.toISOString(),
            updatedAt: item.updatedAt.toISOString(),
        })),
        supportingDocs: [],
        costBreakdown: order.costBreakdown ? JSON.parse(JSON.stringify(order.costBreakdown)) : null,
    }));
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = request.nextUrl;
        const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);
        const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || String(PAGE_SIZE), 10) || PAGE_SIZE));
        const search = (searchParams.get('search') || '').trim();
        const subteam = (searchParams.get('subteam') || '').trim();
        const statusFilter = (searchParams.get('status') || '')
            .split(',')
            .filter((s): s is OrderStatus => (Object.values(OrderStatus) as string[]).includes(s));
        const troubleOnly = searchParams.get('trouble') === '1';
        const query = search.toLowerCase();
        const orderStatuses = (Object.values(OrderStatus) as OrderStatus[]).filter((status) =>
            status.toLowerCase().includes(query)
        );
        const itemStatuses = (Object.values(ItemStatus) as ItemStatus[]).filter((status) =>
            status.toLowerCase().includes(query)
        );

        const activeWhere: Prisma.OrderWhereInput = {
            NOT: { status: { in: ['ARCHIVED', 'EV_ARCHIVED', 'AWAITING_APPROVAL'] } },
        };

        const baseWhere: Prisma.OrderWhereInput = {
            ...activeWhere,
            ...(subteam ? subteamWhere(subteam) : {}),
            ...(statusFilter.length ? { status: { in: statusFilter } } : {}),
            ...(troubleOnly ? { trouble: true } : {}),
        };

        const where: Prisma.OrderWhereInput = search
            ? {
                AND: [
                    baseWhere,
                    {
                        OR: [
                            { name: { contains: search, mode: 'insensitive' } },
                            { vendor: { contains: search, mode: 'insensitive' } },
                            { meenOrderId: { contains: search, mode: 'insensitive' } },
                            { comments: { contains: search, mode: 'insensitive' } },
                            { subteam: { contains: search, mode: 'insensitive' } },
                            { user: { subteam: { contains: search, mode: 'insensitive' } } },
                            { items: { some: { name: { contains: search, mode: 'insensitive' } } } },
                            ...(orderStatuses.length ? [{ status: { in: orderStatuses } }] : []),
                            ...(itemStatuses.length ? [{ items: { some: { status: { in: itemStatuses } } } }] : []),
                        ],
                    },
                ],
            }
            : baseWhere;

        const [orders, total, troubleCount, statusGroups] = await Promise.all([
            prisma.order.findMany({
                where,
                select: orderSelect,
                orderBy: { createdAt: 'desc' },
                skip: offset,
                take: limit,
            }),
            prisma.order.count({ where }),
            prisma.order.count({ where: { ...activeWhere, trouble: true } }),
            prisma.order.groupBy({ by: ['status'], where: activeWhere, _count: { _all: true } }),
        ]);
        const statusCounts = Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all]));

        const response = NextResponse.json({
            orders: serialize(orders),
            total,
            troubleCount,
            statusCounts,
            hasMore: offset + orders.length < total,
        });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        console.error('Error fetching orders:', error);
        return NextResponse.json({ error: 'Error fetching orders' }, { status: 500 });
    }
}
