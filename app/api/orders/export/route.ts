import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';

const prisma = new PrismaClient();

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
    const orders = await prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
            user: true,
            items: true,
            supportingDocs: true,
            receipts: true,
        },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Orders');

    worksheet.columns = [
        { header: 'Order ID', key: 'id', width: 10 },
        { header: 'Internal Order ID', key: 'internalOrderId', width: 20 },
        { header: 'Meen Order ID', key: 'meenOrderId', width: 20 },
        { header: 'Name', key: 'name', width: 20 },
        { header: 'Person Who Placed Order', key: 'user', width: 20 },
        { header: 'Subteam', key: 'subteam', width: 15 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Car Year', key: 'carYear', width: 10 },
        { header: 'Trouble', key: 'trouble', width: 10 },
        { header: 'Vendor', key: 'vendor', width: 20 },
        { header: 'Total Cost', key: 'totalCost', width: 15 },
        { header: 'Cost Verified', key: 'costVerified', width: 15 },
        { header: 'Comments', key: 'comments', width: 30 },
        { header: 'URL', key: 'url', width: 30 },
        { header: 'Carrier', key: 'carrier', width: 15 },
        { header: 'Tracking ID', key: 'trackingId', width: 20 },
        { header: 'Cost Breakdown', key: 'costBreakdown', width: 30 },
        { header: 'Created At', key: 'createdAt', width: 20 },
        { header: 'Updated At', key: 'updatedAt', width: 20 },
        { header: 'Delivery Location', key: 'deliveryLocation', width: 20 },
        { header: 'Items', key: 'items', width: 50 },
        { header: 'Supporting Docs', key: 'supportingDocs', width: 50 },
        { header: 'Receipts', key: 'receipts', width: 50 },
    ];

    orders.forEach(order => {
        worksheet.addRow({
            id: order.id,
            internalOrderId: order.internalOrderId,
            meenOrderId: order.meenOrderId,
            name: order.name,
            user: order.user ? `${order.user.name} (${order.user.email})` : '',
            subteam: order.subteam,
            status: order.status,
            carYear: order.carYear,
            trouble: order.trouble ? 'Yes' : 'No',
            vendor: order.vendor,
            totalCost: order.totalCost,
            costVerified: order.costVerified ? 'Yes' : 'No',
            comments: order.comments,
            url: order.url,
            carrier: order.carrier,
            trackingId: order.trackingId,
            costBreakdown: order.costBreakdown ? JSON.stringify(order.costBreakdown) : '',
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
            deliveryLocation: order.deliveryLocation,
            items: order.items.map(item => `${item.name} (Qty: ${item.quantity}, Price: $${item.price})`).join('; '),
            supportingDocs: order.supportingDocs.map(doc => doc.url).join('; '),
            receipts: order.receipts.map(doc => doc.url).join('; '),
        });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
        status: 200,
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="orders.xlsx"',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
        },
    });
}
