'use client';

import { useEffect, useRef, useState } from 'react';
import { OrderStatus } from '@prisma/client';
import { X } from 'lucide-react';
import { STATUS_EXPLANATION, statusLabel } from '../../lib/order-status';
import styles from './status-about.module.css';

type Box = { cx: number; cy: number; w: number; h: number };
type Tone = 'toOrder' | 'ravi' | 'received' | 'hold' | 'placed' | 'shipped' | 'pickup' | 'delivered' | 'partial';

const GAP = 10;
const CANVAS_W = 910;
const CANVAS_H = 400;
const right = (n: Box) => n.cx + n.w / 2;
const left = (n: Box) => n.cx - n.w / 2;
const top = (n: Box) => n.cy - n.h / 2;
const bottom = (n: Box) => n.cy + n.h / 2;

// Centers match the stakeholder chart. Wires are derived from these boxes.
const NODE: Record<string, Box & { status: OrderStatus; tone: Tone; lines?: [string, string] }> = {
    to: { status: OrderStatus.TO_ORDER, tone: 'toOrder', cx: 86, cy: 168, w: 124, h: 34 },
    ravi: { status: OrderStatus.AWAITING_RAVI_APPROVAL, tone: 'ravi', cx: 430, cy: 48, w: 178, h: 46, lines: ['AWAITING RAVI', 'APPROVAL'] },
    received: { status: OrderStatus.MEEN_RECEIVED, tone: 'received', cx: 430, cy: 168, w: 158, h: 34 },
    hold: { status: OrderStatus.HOLD, tone: 'hold', cx: 792, cy: 48, w: 92, h: 34 },
    placed: { status: OrderStatus.MEEN_PLACED, tone: 'placed', cx: 792, cy: 168, w: 150, h: 34 },
    shipped: { status: OrderStatus.SUPPLIER_SHIPPED, tone: 'shipped', cx: 792, cy: 322, w: 176, h: 34 },
    pickup: { status: OrderStatus.EV_AWAITING_PICKUP, tone: 'pickup', cx: 478, cy: 322, w: 196, h: 34 },
    delivered: { status: OrderStatus.MEEN_DELIVERED, tone: 'delivered', cx: 124, cy: 280, w: 164, h: 34 },
    partial: { status: OrderStatus.PARTIAL_DELIVERY, tone: 'partial', cx: 128, cy: 364, w: 172, h: 34 },
};

const FORK_X = 268;
const BUDGET_X = 236;

function Wire({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
    return <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#status-flow-arrow)" />;
}

export default function StatusAbout({ onClose }: { onClose: () => void }) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLDivElement>(null);
    const [selected, setSelected] = useState<OrderStatus | null>(null);
    const [scale, setScale] = useState(1);

    useEffect(() => {
        const prev = document.activeElement as HTMLElement | null;
        dialogRef.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = overflow;
            prev?.focus?.();
        };
    }, [onClose]);

    useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return;
        const fit = () => {
            const next = frame.clientWidth / CANVAS_W;
            // Below this, shrinking makes the labels unreadable, so the chart scrolls instead.
            setScale(next >= 0.78 ? Math.min(1, next) : 0.78);
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(frame);
        return () => observer.disconnect();
    }, []);

    const to = NODE.to;
    const ravi = NODE.ravi;
    const received = NODE.received;
    const hold = NODE.hold;
    const placed = NODE.placed;
    const shipped = NODE.shipped;
    const pickup = NODE.pickup;
    const delivered = NODE.delivered;
    const partial = NODE.partial;

    return (
        <div className={styles.backdrop} onClick={onClose}>
            <div
                ref={dialogRef}
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="status-about-title"
                tabIndex={-1}
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <div>
                        <h2 id="status-about-title" className={styles.title}>How an order moves</h2>
                        <p className={styles.subtitle}>Click a status to see what it means.</p>
                    </div>
                    <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
                        <X size={16} aria-hidden />
                    </button>
                </header>
                <div className={styles.body}>
                    <div ref={frameRef} className={styles.chartFrame}>
                        <div className={styles.canvasSlot} style={{ width: CANVAS_W * scale, height: CANVAS_H * scale }}>
                            <div className={styles.canvas} style={{ transform: `scale(${scale})` }}>
                            <svg className={styles.wires} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} aria-hidden>
                                <defs>
                                    <marker id="status-flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                                        <path d="M 0 1.2 L 9 5 L 0 8.8 Z" fill="#9aa1ab" />
                                    </marker>
                                </defs>
                                <Wire x1={right(to) + GAP} y1={to.cy} x2={left(received) - GAP} y2={received.cy} />
                                <polyline points={`${BUDGET_X},${to.cy} ${BUDGET_X},${ravi.cy} ${left(ravi) - GAP},${ravi.cy}`} markerEnd="url(#status-flow-arrow)" />
                                <text className={styles.wireLabel} x={BUDGET_X - 8} y={(to.cy + ravi.cy) / 2} textAnchor="end" dominantBaseline="middle">If &gt; $250</text>
                                <Wire x1={ravi.cx} y1={bottom(ravi) + GAP} x2={received.cx} y2={top(received) - GAP} />
                                <polyline points={`${right(ravi) + 40},${received.cy} ${right(ravi) + 40},${hold.cy} ${left(hold) - GAP},${hold.cy}`} markerEnd="url(#status-flow-arrow)" />
                                <text className={styles.wireLabel} x={(right(ravi) + 40 + left(hold) - GAP) / 2} y={hold.cy - 14} textAnchor="middle">If MEEN problem</text>
                                <Wire x1={hold.cx} y1={bottom(hold) + GAP} x2={placed.cx} y2={top(placed) - GAP} />
                                <Wire x1={right(received) + GAP} y1={received.cy} x2={left(placed) - GAP} y2={placed.cy} />
                                <Wire x1={placed.cx} y1={bottom(placed) + GAP} x2={shipped.cx} y2={top(shipped) - GAP} />
                                <text className={styles.wireLabel} x={placed.cx - 14} y={(bottom(placed) + top(shipped)) / 2} textAnchor="end" dominantBaseline="middle">(hopefully)</text>
                                <Wire x1={left(shipped) - GAP} y1={shipped.cy} x2={right(pickup) + GAP} y2={pickup.cy} />
                                <polyline points={`${left(pickup) - GAP},${pickup.cy} ${FORK_X},${pickup.cy} ${FORK_X},${delivered.cy}`} />
                                <polyline points={`${FORK_X},${pickup.cy} ${FORK_X},${partial.cy}`} />
                                <Wire x1={FORK_X} y1={delivered.cy} x2={right(delivered) + GAP} y2={delivered.cy} />
                                <Wire x1={FORK_X} y1={partial.cy} x2={right(partial) + GAP} y2={partial.cy} />
                            </svg>
                            {Object.values(NODE).map((node) => {
                                const on = selected === node.status;
                                return (
                                    <button
                                        key={node.status}
                                        type="button"
                                        className={`${styles.node} ${styles[node.tone]} ${on ? styles.nodeOn : ''}`}
                                        style={{ left: node.cx, top: node.cy, width: node.w, height: node.h }}
                                        aria-pressed={on}
                                        onClick={() => setSelected(node.status)}
                                    >
                                        {node.lines ? node.lines.map((line) => <span key={line}>{line}</span>) : statusLabel(node.status)}
                                    </button>
                                );
                            })}
                            </div>
                        </div>
                    </div>
                    <div className={styles.detail} aria-live="polite">
                        {selected ? (
                            <>
                                <span className={`${styles.detailPill} ${styles[toneFor(selected)]}`}>{statusLabel(selected)}</span>
                                <p>{STATUS_EXPLANATION[selected]}</p>
                            </>
                        ) : (
                            <p className={styles.hint}>Click a status. It enlarges, and a description of that step shows here.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function toneFor(status: OrderStatus): Tone {
    const node = Object.values(NODE).find((entry) => entry.status === status);
    return node?.tone ?? 'ravi';
}
