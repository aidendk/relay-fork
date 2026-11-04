export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../lib/prisma';
import { ItemStatus, OrderStatus, Prisma } from '@prisma/client';

const PAGE_SIZE = 15;

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
        const query = search.toLowerCase();
        const orderStatuses = (Object.values(OrderStatus) as OrderStatus[]).filter((status) =>
            status.toLowerCase().includes(query)
        );
        const itemStatuses = (Object.values(ItemStatus) as ItemStatus[]).filter((status) =>
            status.toLowerCase().includes(query)
        );

        const baseWhere: Prisma.OrderWhereInput = {
            NOT: { status: { in: ['ARCHIVED', 'EV_ARCHIVED', 'AWAITING_APPROVAL'] } },
            ...(subteam ? { subteam: { equals: subteam, mode: 'insensitive' } } : {}),
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

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                select: orderSelect,
                orderBy: { createdAt: 'desc' },
                skip: offset,
                take: limit,
            }),
            prisma.order.count({ where }),
        ]);

        const response = NextResponse.json({
            orders: serialize(orders),
            total,
            hasMore: offset + orders.length < total,
        });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        console.error('Error fetching orders:', error);
        return NextResponse.json({ error: 'Error fetching orders' }, { status: 500 });
    }
}
