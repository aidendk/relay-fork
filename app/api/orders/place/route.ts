// /api/orders/place
import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { ItemStatus, OrderStatus } from '@prisma/client';
import { checkBudgetExceeded } from '../../../lib/budgets';
import { CURRENT_CAR_YEAR, isCarYear } from '../../../lib/car-year';

export async function POST(request: NextRequest) {

    const body = await request.json();
    const { orderName, cartUrl, items, vendor, totalCost, comments, costBreakdown, supportingDocs, deliveryLocation } = body;

    const userEmail = body.userEmail;
    if (body.carYear !== undefined && !isCarYear(body.carYear)) {
        return NextResponse.json({ error: `Invalid car year: ${body.carYear}` }, { status: 400 });
    }
    const carYear: string = body.carYear ?? CURRENT_CAR_YEAR;

    // Get the user from the database
    const user = await prisma.user.findUnique({
        where: { email: userEmail },
    });

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!orderName || !vendor) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Check if it's a Cart URL Order (no items but has cartUrl)
    if (cartUrl && (!items || items.length === 0)) {
        if (!orderName || !cartUrl) {
            return NextResponse.json({ error: 'Missing required fields for cart URL order' }, { status: 400 });
        }

        const parsedCost = parseFloat(body.estimatedCost) || 0;

        // Check budget
        const budgetCheck = costBreakdown
            ? await checkBudgetExceeded(costBreakdown, parsedCost, carYear)
            : { exceeded: false, subteams: [] };
        const orderStatus = budgetCheck.exceeded
            ? OrderStatus.AWAITING_RAVI_APPROVAL
            : OrderStatus.TO_ORDER;

        try {
            const order = await prisma.order.create({
                data: {
                    internalOrderId: `ORD-${Math.floor(Math.random() * 100000)}`,
                    name: orderName,
                    userId: user.id,
                    subteam: user.subteam,
                    status: orderStatus,
                    vendor,
                    totalCost: parsedCost,
                    comments: comments || '',
                    url: cartUrl || null,
                    costBreakdown,
                    deliveryLocation,
                    carYear,
                },
            });

            if (supportingDocs && supportingDocs.length > 0) {
                await prisma.document.createMany({
                    data: supportingDocs.map((doc: { url: string; }) => ({
                    url: doc.url,
                    supportingOrderId: order.id,
                    })),
                });
                }

            if (budgetCheck.exceeded) {
                return NextResponse.json({
                    message: 'Order submitted for approval',
                    needsApproval: true,
                    exceededSubteams: budgetCheck.subteams,
                });
            }
            return NextResponse.json({ message: 'Order and documents created successfully' });
        } catch (error) {
            console.error('Error creating cart URL order:', error);
            return NextResponse.json({ error: 'Error creating cart URL order' }, { status: 500 });
        }

    } else if (items && items.length > 0) {
        // Handle Single Item Order (has items)
        const { itemName, partNumber, quantity, cost, link } = items[0]; // Assuming the first item is relevant

        if (!itemName || !quantity || !cost || !vendor) {
            return NextResponse.json({ error: 'Missing required fields for single item order' }, { status: 400 });
        }

        const orderCost = totalCost || cost * quantity;

        // Check budget
        const budgetCheck = costBreakdown
            ? await checkBudgetExceeded(costBreakdown, orderCost, carYear)
            : { exceeded: false, subteams: [] };
        const orderStatus = budgetCheck.exceeded
            ? OrderStatus.AWAITING_RAVI_APPROVAL
            : OrderStatus.TO_ORDER;

        // Create the order with a single item
        try {
            await prisma.order.create({
                data: {
                    internalOrderId: `ORD-${Math.floor(Math.random() * 100000)}`,
                    name: orderName || `Order by ${user.name}`,
                    userId: user.id,
                    subteam: user.subteam,
                    status: orderStatus,
                    vendor: vendor,
                    totalCost: orderCost,
                    comments: comments || '',
                    costBreakdown: costBreakdown, // Include cost breakdown
                    items: {
                        create: {
                            internalItemId: `ITEM-${Math.floor(Math.random() * 100000)}`,
                            name: itemName,
                            partNumber: partNumber || '',
                            notes: comments || null,
                            quantity: parseInt(quantity, 10),
                            price: parseFloat(cost),
                            vendor: vendor,
                            link: link || null,
                            status: ItemStatus.TO_ORDER,
                        },
                    },
                    deliveryLocation: deliveryLocation,
                    carYear,
                },
            });

            if (budgetCheck.exceeded) {
                return NextResponse.json({
                    message: 'Order submitted for approval',
                    needsApproval: true,
                    exceededSubteams: budgetCheck.subteams,
                });
            }
            return NextResponse.json({ message: 'Single item order created successfully' });
        } catch (error) {
            console.error('Error creating single item order:', error);
            return NextResponse.json({ error: 'Error creating single item order' }, { status: 500 });
        }

    } else {
        return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
    }
}
