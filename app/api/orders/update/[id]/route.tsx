import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { ItemStatus, OrderStatus, Prisma } from '@prisma/client';
import { isCarYear } from '../../../../lib/car-year';

// Define the progression of statuses with corresponding indices
const orderStatusIndices: { [key in OrderStatus]: number } = {
  AWAITING_APPROVAL: -1,
  TO_ORDER: 0,
  PLACED: 1,
  MEEN_HOLD: 2,
  PROCESSED: 3,
  SHIPPED: 4,
  AWAITING_PICKUP: 5,
  PARTIAL: 6,
  DELIVERED: 7,
  ARCHIVED: 8,
  AWAITING_RAVI_APPROVAL: 10,
  HOLD: 11,
  MEEN_RECEIVED: 12,
  MEEN_PLACED: 13,
  SUPPLIER_SHIPPED: 14,
  EV_AWAITING_PICKUP: 15,
  PARTIAL_DELIVERY: 16,
  MEEN_DELIVERED: 17,
  EV_ARCHIVED: 18,
};

const itemStatusIndices: { [key in ItemStatus]: number } = {
  TO_ORDER: 0,
  PLACED: 1,
  PROCESSED: 2,
  SHIPPED: 3,
  DELIVERED: 4,
  PICKED_UP: 5,
};

// Map order statuses to item statuses
function mapOrderStatusToItemStatus(orderStatus: OrderStatus): ItemStatus | null {
  if (orderStatus === OrderStatus.ARCHIVED) {
    // Map ARCHIVED to PICKED_UP for items
    return ItemStatus.PICKED_UP;
  } else if (orderStatus === OrderStatus.TO_ORDER) {
    return ItemStatus.TO_ORDER;
  } else if (orderStatus === OrderStatus.PLACED) {
    return ItemStatus.PLACED;
  } else if (orderStatus === OrderStatus.MEEN_HOLD) {
    return ItemStatus.PLACED;
  } else if (orderStatus === OrderStatus.PROCESSED) {
    return ItemStatus.PROCESSED;
  } else if (orderStatus === OrderStatus.SHIPPED) {
    return ItemStatus.SHIPPED;
  } else if (orderStatus === OrderStatus.AWAITING_PICKUP) {
    return ItemStatus.SHIPPED;
  } else if (orderStatus === OrderStatus.PARTIAL) {
    return ItemStatus.SHIPPED;
  } else if (orderStatus === OrderStatus.DELIVERED) {
    return ItemStatus.DELIVERED;
  } else {
    return null;
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const orderId = Number(id);
  const body = await request.json();
  const { status: statusString, totalCost, costVerified, carrier, trackingId, meenOrderId, comments, costBreakdown, carYear, trouble } = body;
  
  console.log('Update request received:', { orderId, statusString, totalCost, costVerified, carrier, trackingId, meenOrderId, comments });

  if (!statusString || !orderStatusIndices.hasOwnProperty(statusString)) {
    return NextResponse.json({ error: `Invalid status: ${statusString}` }, { status: 400 });
  }

  if (carYear !== undefined && !isCarYear(carYear)) {
    return NextResponse.json({ error: `Invalid car year: ${carYear}` }, { status: 400 });
  }
  if (trouble !== undefined && typeof trouble !== 'boolean') {
    return NextResponse.json({ error: 'trouble must be a boolean' }, { status: 400 });
  }

  const newOrderStatus = statusString as OrderStatus;

  try {
    // Fetch the current order status before updating
    const currentOrder = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });

    if (!currentOrder) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const currentOrderStatus = currentOrder.status;
    const currentOrderStatusIndex = orderStatusIndices[currentOrderStatus];
    const newOrderStatusIndex = orderStatusIndices[newOrderStatus];

    console.log('Status transition:', { from: currentOrderStatus, to: newOrderStatus, fromIndex: currentOrderStatusIndex, toIndex: newOrderStatusIndex });

    const updateData: {
      status: OrderStatus;
      totalCost?: number;
      costVerified?: boolean;
      carrier?: string;
      trackingId?: string;
      meenOrderId?: string;
      comments?: string;
      costBreakdown?: Prisma.InputJsonValue;
      carYear?: string;
      trouble?: boolean;
    } = {
      status: newOrderStatus,
    };

    if (totalCost !== undefined) updateData.totalCost = totalCost;
    if (costVerified !== undefined) updateData.costVerified = costVerified;
    if (carrier !== undefined) updateData.carrier = carrier;
    if (trackingId !== undefined) updateData.trackingId = trackingId;
    if (meenOrderId !== undefined) updateData.meenOrderId = meenOrderId;
    if (comments !== undefined) updateData.comments = comments;
    if (costBreakdown !== undefined) updateData.costBreakdown = costBreakdown;
    if (carYear !== undefined) updateData.carYear = carYear;
    if (trouble !== undefined) updateData.trouble = trouble;

    console.log('Update data:', updateData);

    // Update the order status, total cost, and cost verification if provided
    const result = await prisma.order.update({
      where: { id: orderId },
      data: updateData,
    });

    console.log('Order updated:', result);

    // Map the new order status to an item status, if applicable
    const mappedItemStatus = mapOrderStatusToItemStatus(newOrderStatus);

    // Proceed only if the new order status is not PARTIAL and a mapped item status exists
    if (newOrderStatus !== OrderStatus.PARTIAL && mappedItemStatus) {
      if (newOrderStatusIndex < currentOrderStatusIndex) {
        // Reverse update: Update all items to match the new order status if moving backward
        await prisma.item.updateMany({
          where: { orderId },
          data: { status: mappedItemStatus },
        });
      } else {
        // Forward update: Only update items that are less advanced than the new order status
        const statusesToUpdate = (Object.keys(itemStatusIndices) as ItemStatus[])
          .filter(
            (itemStatus) =>
              itemStatusIndices[itemStatus] < newOrderStatusIndex &&
              itemStatus !== ItemStatus.PICKED_UP // Exclude the highest item status
          );

        await prisma.item.updateMany({
          where: {
            orderId,
            status: { in: statusesToUpdate },
          },
          data: { status: mappedItemStatus },
        });
      }
    }

    // Fetch the updated order with related data to return
    const updatedOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true, items: true },
    });

    console.log('Returning updated order:', updatedOrder);
    return NextResponse.json(updatedOrder);
  } catch (error) {
    console.error('Failed to update order:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: 'Failed to update order', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
