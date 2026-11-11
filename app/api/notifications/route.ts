import { NextRequest, NextResponse } from 'next/server';

// endpoint to receive pub/sub messages
export async function POST(req: NextRequest) {

    try {
        const body = await req.json();
        const message = body.message;
        const data = Buffer.from(message.data, 'base64').toString('utf-8');
        const notification = JSON.parse(data);

        console.log('Received!')
        console.log('message:', message);
        console.log('data:', data);
        console.log('notification:', notification);

        const processResponse = await fetch(`https://relay.tamuformulaelectric.com/api/notifications/process`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ historyId: notification.historyId }),
        });

        if (!processResponse.ok) {
            throw new Error('Failed to process notification');
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error processing Pub/Sub message:', error);
        return NextResponse.json({ success: false });
    }
}
