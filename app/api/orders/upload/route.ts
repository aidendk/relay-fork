import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { parse } from 'csv-parse/sync';
import { ItemStatus, OrderStatus } from '@prisma/client';
import { checkBudgetExceeded } from '../../../lib/budgets';
import { CURRENT_CAR_YEAR, isCarYear } from '../../../lib/car-year';

const REQUIRED_HEADERS = ['Item', 'Part Number', 'Notes', 'QTY to Buy', 'Cost', 'Vendor', 'Link'];

interface Record {
    Item: string;
    'Part Number'?: string;
    Notes?: string;
    'QTY to Buy': string;
    Cost: string;
    Vendor: string;
    Link?: string;
    [key: string]: string | undefined;
}

interface SupportingDoc {
    name: string;
    url: string;
}

export async function POST(request: NextRequest) {
    try {
        // Parse the multipart/form-data
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const userEmail = formData.get('userEmail') as string;

        const user = await prisma.user.findUnique({
            where: { email: userEmail },
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const orderName = formData.get('orderName') as string;
        const vendor = formData.get('vendor') as string;
        const notes = formData.get('notes') as string;
        const estimatedCost = parseFloat(formData.get('estimatedCost') as string) || 0;
        const deliveryLocation = formData.get('deliveryLocation') as string;
        const carYearInput = formData.get('carYear');
        if (carYearInput !== null && !isCarYear(carYearInput)) {
            return NextResponse.json({ error: `Invalid car year: ${carYearInput}` }, { status: 400 });
        }
        const carYear = carYearInput ?? CURRENT_CAR_YEAR;

        // Process cost breakdown
        const costBreakdownEntries: [string, number][] = [];
        for (const entry of formData.entries()) {
            const [key, value] = entry;
            if (key.startsWith('costBreakdown[') && key.endsWith(']')) {
                const subteam = key.slice(14, -1);
                const percentage = parseFloat(value as string);
                if (!isNaN(percentage)) {
                    costBreakdownEntries.push([subteam, percentage]);
                }
            }
        }
        const costBreakdown = Object.fromEntries(costBreakdownEntries);

        // Initialize items data array
        const itemsData: {
            internalItemId: string;
            name: string;
            partNumber: string;
            notes: string | null;
            quantity: number;
            price: number;
            vendor: string;
            link: string | null;
            status: ItemStatus;
        }[] = [];

        // Check if this is a CSV upload or template form submission
        if (file && file.name.endsWith('.csv')) {
            // Parse CSV content
            const content = await file.text();
            const parsedData: string[][] = parse(content, {
                columns: false,
                skip_empty_lines: true,
                relax_column_count: true,
            });

            // Remove header instruction if present
            if (
                parsedData.length > 0 &&
                parsedData[0][0] &&
                parsedData[0][0].startsWith('MAKE A COPY AND FILL OUT YOUR OWN FILE')
            ) {
                parsedData.shift();
            }

            // Validate headers
            const headers = parsedData.shift();
            if (!headers) {
                return NextResponse.json({ error: 'CSV headers missing' }, { status: 400 });
            }

            const headersMatch = REQUIRED_HEADERS.every((header, index) => headers[index] === header);
            if (!headersMatch) {
                return NextResponse.json({
                    error: 'Invalid CSV format. Headers must exactly match the template.',
                    expected: REQUIRED_HEADERS,
                    received: headers
                }, { status: 400 });
            }

            // Process records
            let records = parsedData.map((row: string[]) => {
                const record = {} as Record;
                headers.forEach((header: string, index: number) => {
                    record[header] = row[index];
                });
                return record;
            });

            // Filter valid records
            records = records.filter((record: Record) => {
                const { Item, 'QTY to Buy': qtyToBuy, Cost, Vendor } = record;
                const quantity = parseInt(qtyToBuy, 10);
                const sanitizedCost = Cost ? Cost.replace(/[^0-9.-]+/g, '') : '';
                const price = parseFloat(sanitizedCost);
                return (
                    Item && qtyToBuy && Cost && Vendor &&
                    !isNaN(quantity) && !isNaN(price)
                );
            });

            // Validate vendor consistency - all items must have the same vendor as specified in previous screens
            const inconsistentVendors = records.filter((record: Record) => {
                return record.Vendor.trim().toLowerCase() !== vendor.trim().toLowerCase();
            });

            if (inconsistentVendors.length > 0) {
                const vendorNames = [...new Set(inconsistentVendors.map(r => r.Vendor))];
                return NextResponse.json({
                    error: `Vendor mismatch: All items must use vendor "${vendor}". Found items with different vendors: ${vendorNames.join(', ')}. Each order must use a single vendor.`,
                    inconsistentItems: inconsistentVendors.map(r => r.Item)
                }, { status: 400 });
            }

            // Prepare items data from CSV
            itemsData.push(...records.map(record => {
                const { Item, 'Part Number': partNumber, Notes, 'QTY to Buy': qtyToBuy, Cost, Vendor, Link } = record;
                const sanitizedCost = Cost.replace(/[^0-9.-]+/g, '');
                const quantity = parseInt(qtyToBuy, 10);
                const price = parseFloat(sanitizedCost);

                return {
                    internalItemId: `ITEM-${Math.floor(Math.random() * 100000)}`,
                    name: Item,
                    partNumber: partNumber || '',
                    notes: Notes || null,
                    quantity,
                    price,
                    vendor: Vendor,
                    link: Link || null,
                    status: ItemStatus.TO_ORDER,
                };
            }));
        } else {
            // Handle template form submission (existing logic)
            const templateItems: {
                internalItemId: string;
                name: string;
                partNumber: string;
                notes: string | null;
                quantity: number;
                price: number;
                vendor: string;
                link: string | null;
                status: ItemStatus;
            }[] = [];

            for (let i = 0; formData.has(`items[${i}][itemName]`); i++) {
                const itemName = formData.get(`items[${i}][itemName]`) as string;
                const partNumber = formData.get(`items[${i}][partNumber]`) as string;
                const notes = formData.get(`items[${i}][notes]`) as string;
                const quantity = parseInt(formData.get(`items[${i}][quantity]`) as string, 10);
                const cost = parseFloat(formData.get(`items[${i}][cost]`) as string);
                const itemVendor = formData.get(`items[${i}][vendor]`) as string;
                const link = formData.get(`items[${i}][link]`) as string;

                if (!itemName || !quantity || !cost || !itemVendor) continue; // basic validation

                templateItems.push({
                    internalItemId: `ITEM-${Math.floor(Math.random() * 100000)}`,
                    name: itemName,
                    partNumber: partNumber || "",
                    notes: notes || null,
                    quantity,
                    price: cost,
                    vendor: itemVendor,
                    link: link || null,
                    status: ItemStatus.TO_ORDER,
                });
            }

            // Validate vendor consistency for template form items
            const inconsistentTemplateVendors = templateItems.filter((item) => {
                return item.vendor.trim().toLowerCase() !== vendor.trim().toLowerCase();
            });

            if (inconsistentTemplateVendors.length > 0) {
                const vendorNames = [...new Set(inconsistentTemplateVendors.map(item => item.vendor))];
                return NextResponse.json({
                    error: `Vendor mismatch: All items must use vendor "${vendor}". Found items with different vendors: ${vendorNames.join(', ')}. Each order must use a single vendor.`,
                    inconsistentItems: inconsistentTemplateVendors.map(item => item.name)
                }, { status: 400 });
            }

            itemsData.push(...templateItems);
        }

        // Process supporting documents
        const supportingDocs: SupportingDoc[] = [];
        for (let i = 0; formData.has(`supportingDocs[${i}][url]`); i++) {
            const name = formData.get(`supportingDocs[${i}][name]`) as string;
            const url = formData.get(`supportingDocs[${i}][url]`) as string;
            supportingDocs.push({ name, url });
        }

        // Check budget
        const budgetCheck = Object.keys(costBreakdown).length > 0
            ? await checkBudgetExceeded(costBreakdown, estimatedCost, carYear)
            : { exceeded: false, subteams: [] };
        const orderStatus = budgetCheck.exceeded
            ? OrderStatus.AWAITING_RAVI_APPROVAL
            : OrderStatus.TO_ORDER;

        // Execute database operations in a transaction
        const result = await prisma.$transaction(async (tx) => {
            // Create order
            const order = await tx.order.create({
                data: {
                    internalOrderId: `ORD-${Math.floor(Math.random() * 100000)}`,
                    name: orderName,
                    userId: user.id,
                    subteam: user.subteam,
                    status: orderStatus,
                    vendor: vendor || '',
                    totalCost: estimatedCost,
                    comments: notes || '',
                    costBreakdown,
                    deliveryLocation: deliveryLocation || '',
                    carYear,
                },
                include: {
                    items: true
                }
            });

            // Create items if any
            if (itemsData.length > 0) {
                await tx.item.createMany({
                    data: itemsData.map((item) => ({
                        ...item,
                        orderId: order.id,
                    })),
                });
            }

            // Create supporting documents if any
            if (supportingDocs.length > 0) {
                await tx.document.createMany({
                    data: supportingDocs.map((doc) => ({
                        url: doc.url,
                        supportingOrderId: order.id,
                    })),
                });
            }

            // Return complete order with all relations
            return await tx.order.findUnique({
                where: { id: order.id },
                include: {
                    items: true,
                    supportingDocs: true
                }
            });
        });

        console.log('Created order with items:', JSON.stringify(result, null, 2));

        if (budgetCheck.exceeded) {
            return NextResponse.json({
                message: 'Order submitted for approval',
                needsApproval: true,
                exceededSubteams: budgetCheck.subteams,
                order: result,
            });
        }

        return NextResponse.json({
            message: 'Order, items, and documents created successfully',
            order: result
        });

    } catch (error) {
        console.error('Error processing upload:', error);
        return NextResponse.json({
            error: error instanceof Error ? error.message : 'Error creating order'
        }, { status: 500 });
    }
}