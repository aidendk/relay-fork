export const dynamic = 'force-dynamic';

import { gmail_v1, google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import { loadOAuthClient } from '../../../lib/google-auth';
import prisma from '../../../lib/prisma';
import { OpenAI } from 'openai';

const SYNC_SECRET = process.env.SYNC_SECRET;

interface EmailData {
  messageId: string;
  sender: string;
  subject: string;
  snippet: string;
  body: string;
}

interface OrderDetails {
  meenId: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  orderStatus: string | null;
  vendorOrderId: string | null;
  itemName: string | null;
  vendorName: string | null;
}

async function extractBody(
  payload: gmail_v1.Schema$MessagePart,
  gmail: gmail_v1.Gmail,
  messageId: string
): Promise<string> {
  let body = '';

  if (payload.body?.data) {
    const encoded = payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
    body = Buffer.from(encoded, 'base64').toString('utf-8');
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType?.startsWith('multipart/') || part.mimeType === 'text/plain') {
        body += await extractBody(part, gmail, messageId);
      }
    }
  }

  return body;
}

async function fetchNewMessages(
  auth: OAuth2Client,
  startHistoryId: string
): Promise<EmailData[]> {
  const gmail = google.gmail({ version: 'v1', auth });

  const historyRes = await gmail.users.history.list({
    userId: 'me',
    startHistoryId,
    historyTypes: ['messageAdded'],
  });

  const historyItems = historyRes.data.history || [];
  const seenIds = new Set<string>();
  const emails: EmailData[] = [];

  for (const item of historyItems) {
    for (const added of item.messagesAdded || []) {
      const id = added.message?.id;
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);

      let msg;
      try {
        msg = await gmail.users.messages.get({ userId: 'me', id });
      } catch (err: any) {
        if (err?.code === 404 || err?.status === 404) {
          console.warn(`Message ${id} not found (deleted/trashed), skipping`);
          continue;
        }
        throw err;
      }
      const payload = msg.data.payload;
      if (!payload) continue;

      const headers = payload.headers || [];
      const sender = headers.find(h => h.name === 'From')?.value || '';
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const snippet = msg.data.snippet || '';
      const body = await extractBody(payload, gmail, id);

      emails.push({ messageId: id, sender, subject, snippet, body });
    }
  }

  return emails;
}

// Returns the updated historyId from the history response, or the existing one
async function getLatestHistoryId(auth: OAuth2Client): Promise<string> {
  const gmail = google.gmail({ version: 'v1', auth });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  return profile.data.historyId!;
}

let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set');
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

async function extractOrderDetails(query: string): Promise<OrderDetails | null> {
  const schema = {
    meenId: { title: 'MEEN Order Id', type: 'string' },
    carrier: { title: 'Carrier', type: 'string' },
    trackingNumber: { title: 'Tracking Number', type: 'string' },
    orderStatus: { title: 'Order Status', type: 'string' },
    vendorOrderId: { title: 'Vendor ID', type: 'string' },
    itemName: { title: 'Item Names', type: 'string' },
    vendorName: { title: 'Vendor Name', type: 'string' },
  };

  const prompt = `
  Please extract the following details from the provided shipment information. Follow the specific guidelines for each field and ensure that you return **null** if the information is not clearly stated. Do not infer or assume any details. Return the response only in JSON format according to the specified schema.

  ### Required Fields:

  1. **meenId**:
  - Look for an exact match for the pattern **"MEEN: [4 digit number]"** (e.g., MEEN: 1234) and only return the 4 digit number (not the word MEEN).
  - If no MEEN ID follows this pattern or is not explicitly mentioned, return **null**.

  2. **Carrier**:
  - Identify the shipping company (e.g., UPS, FedEx, DHL). Common variations and abbreviations of carrier names can be used (e.g., "FedEx" for "Federal Express").
  - If no carrier name is explicitly mentioned, return **null**.

  3. **Tracking Number**:
  - Identify the unique tracking number associated with the shipment.
  - If no tracking number is explicitly provided, return **null**.

  4. **Order Status**:
  - Extract the current status of the order (e.g., Ordered, Shipped, Delivered, In transit).
  - If no clear order status is stated, return **null**.
  - PLEASE RETURN in the form of TO_ORDER, PLACED, MEEN_HOLD, PROCESSED, SHIPPED, AWAITING_PICKUP, DELIVERED, and no variation of these (exact spelling).

  5. **Vendor Order Number**:
  - Look for any unique order number provided by the vendor, often labeled as **Order #** or similar.
  - If no vendor order number is explicitly mentioned, return **null**.

  6. **itemName**:
  - Provide the exact name of the item as listed in the shipment information.
  - If no item name is mentioned, return **null**.

  7. **Vendor Name**:
  - Extract the vendor's name based on phrases like "Sold by" or "Vendor."
  - If no vendor name is explicitly stated, return **null**.

  ### Important Notes:
  - **Return null** only when the information is **not explicitly present**.
  - Do not provide any additional comments or explanations outside the JSON response.
  - The output must strictly follow the JSON schema.

  Here is the shipment information you need to analyze:

  Return the response **only** as a JSON object.
  `;

  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 1500,
    messages: [
      {
        role: 'system',
        content: `You will parse data about shipment information and output in JSON. Only return information what is extracted from the query. \nThe JSON object must use the schema: ${JSON.stringify(schema, null, 4)}. Only return the JSON object and no extra text.`,
      },
      {
        role: 'user',
        content: prompt + query,
      },
    ],
  });

  let content = completion.choices[0].message.content;
  if (!content) return null;

  console.log('llm data: ', content);

  const start = content.indexOf('{');
  const end = content.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) return null;
  content = content.substring(start, end);

  try {
    return JSON.parse(content) as OrderDetails;
  } catch (error) {
    console.error('Failed to parse JSON: ', error);
    return null;
  }
}

const VALID_ORDER_STATUSES = new Set([
  'TO_ORDER', 'PLACED', 'MEEN_HOLD', 'PROCESSED',
  'SHIPPED', 'AWAITING_PICKUP', 'DELIVERED', 'PICKED_UP',
]);

export async function POST(req: NextRequest) {
  // Simple shared-secret auth for the GitLab runner
  const authHeader = req.headers.get('authorization');
  if (SYNC_SECRET && authHeader !== `Bearer ${SYNC_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const syncRecord = await prisma.gmailSync.upsert({
    where: { id: 1 },
    create: { id: 1, lastStatus: 'running' },
    update: { lastStatus: 'running', lastError: null },
  });

  try {
    const auth = await loadOAuthClient();

    // If no checkpoint yet, seed with current historyId and exit
    if (!syncRecord.lastHistoryId) {
      const historyId = await getLatestHistoryId(auth);
      await prisma.gmailSync.update({
        where: { id: 1 },
        data: { lastHistoryId: historyId, lastSyncAt: new Date(), lastStatus: 'seeded' },
      });
      return NextResponse.json({ status: 'seeded', historyId });
    }

    let emails: EmailData[];
    try {
      emails = await fetchNewMessages(auth, syncRecord.lastHistoryId);
    } catch (err: any) {
      // Gmail returns 404 when startHistoryId is older than its history retention (~1 week).
      // Re-seed the checkpoint so future syncs can resume instead of failing forever.
      if (err?.code === 404 || err?.status === 404) {
        const historyId = await getLatestHistoryId(auth);
        console.warn(`History ${syncRecord.lastHistoryId} expired, re-seeding at ${historyId}`);
        await prisma.gmailSync.update({
          where: { id: 1 },
          data: { lastHistoryId: historyId, lastSyncAt: new Date(), lastStatus: 'reseeded' },
        });
        return NextResponse.json({ status: 'reseeded', historyId });
      }
      throw err;
    }
    const latestHistoryId = await getLatestHistoryId(auth);

    async function processEmail(email: EmailData): Promise<{ processed: number; skipped: number }> {
      const existing = await prisma.order.findUnique({
        where: { gmailMessageId: email.messageId },
      });
      if (existing) return { processed: 0, skipped: 1 };

      const details = await extractOrderDetails(
        `Subject: ${email.subject}\nFrom: ${email.sender}\n\n${email.body}`
      );

      if (!details) return { processed: 0, skipped: 1 };

      if (details.meenId) {
        const order = await prisma.order.findFirst({
          where: { meenOrderId: details.meenId },
        });

        if (order) {
          const updateData: Record<string, unknown> = { gmailMessageId: email.messageId };
          if (details.carrier) updateData.carrier = details.carrier;
          if (details.trackingNumber) updateData.trackingId = details.trackingNumber;
          if (details.orderStatus && VALID_ORDER_STATUSES.has(details.orderStatus)) {
            updateData.status = details.orderStatus;
          }
          await prisma.order.update({ where: { id: order.id }, data: updateData });
          return { processed: 1, skipped: 0 };
        }
      }

      return { processed: 0, skipped: 1 };
    }

    const results = await Promise.all(emails.map(processEmail));

    const { processed, skipped } = results.reduce(
      (acc, r) => ({ processed: acc.processed + r.processed, skipped: acc.skipped + r.skipped }),
      { processed: 0, skipped: 0 }
    );

    // Update checkpoint only after full success
    await prisma.gmailSync.update({
      where: { id: 1 },
      data: {
        lastHistoryId: latestHistoryId,
        lastSyncAt: new Date(),
        lastStatus: 'success',
      },
    });

    return NextResponse.json({ status: 'success', processed, skipped, total: emails.length });

  } catch (error) {
    const err = error as Error;
    console.error('Gmail sync error:', err);

    await prisma.gmailSync.update({
      where: { id: 1 },
      data: { lastStatus: 'error', lastError: err.message },
    });

    return NextResponse.json({ error: 'Sync failed', message: err.message }, { status: 500 });
  }
}
