import { OrderStatus } from '@prisma/client';

export function statusLabel(status: string) {
    return status.replace(/_/g, ' ');
}

// Statuses a person can assign. Retired enum values stay in the schema for old rows.
export const SELECTABLE_ORDER_STATUSES: OrderStatus[] = [
    OrderStatus.TO_ORDER,
    OrderStatus.AWAITING_RAVI_APPROVAL,
    OrderStatus.HOLD,
    OrderStatus.MEEN_RECEIVED,
    OrderStatus.MEEN_PLACED,
    OrderStatus.SUPPLIER_SHIPPED,
    OrderStatus.EV_AWAITING_PICKUP,
    OrderStatus.PARTIAL_DELIVERY,
    OrderStatus.MEEN_DELIVERED,
    OrderStatus.ARCHIVED,
];

// One explanation per status. The About chart and the table pills both read this,
// so the hover text and the click text cannot drift apart.
export const STATUS_EXPLANATION: Record<OrderStatus, string> = {
    TO_ORDER: 'Our finance team has not completed the MEEN purchase request yet.',
    AWAITING_RAVI_APPROVAL: 'This order is over $250, so it is waiting on Dr. Ravi\'s approval before it can be purchased.',
    HOLD: 'MEEN found a problem with this order. It is on hold until someone takes action.',
    MEEN_RECEIVED: 'The Department of Mechanical Engineering has received the request and is reviewing it before purchasing. A MEEN order ID has been assigned.',
    MEEN_PLACED: 'Mechanical Engineering has placed the order with the supplier and recorded the supplier\'s order number.',
    SUPPLIER_SHIPPED: 'The supplier has shipped the order and shared delivery details, such as a tracking number.',
    EV_AWAITING_PICKUP: 'The order has arrived and is waiting for the team to pick it up.',
    PARTIAL_DELIVERY: 'Only part of the order has been delivered. The rest is still on the way.',
    MEEN_DELIVERED: 'The full order has been delivered.',
    AWAITING_APPROVAL: 'A teammate still needs to approve this order before finance starts the purchase request.',
    PLACED: 'The order has been placed with the supplier.',
    MEEN_HOLD: 'MEEN found a problem with this order. It is on hold until someone takes action.',
    PROCESSED: 'MEEN has the request and is reviewing it before the purchase goes through.',
    SHIPPED: 'The supplier has shipped the order.',
    AWAITING_PICKUP: 'The order has arrived and is waiting to be picked up.',
    PARTIAL: 'Only part of the order has arrived. The rest is still on the way.',
    DELIVERED: 'The full order has been delivered.',
    ARCHIVED: 'This order is finished and has been archived.',
    EV_ARCHIVED: 'This order is finished and has been archived.',
};
