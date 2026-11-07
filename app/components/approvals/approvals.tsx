'use client';

import React, { useState, useEffect } from 'react';
import styles from './approvals.module.css';
import useSWR, { mutate } from 'swr';
import { useSession } from 'next-auth/react';
import { isPM, SUBTEAM_BUDGETS } from '../../lib/budget-config';
import { checkAdmin } from '../../lib/checkAdmin';
import { useToast } from '../toast/use-toast';

interface User {
  id: number;
  name: string;
  email: string;
  subteam: string;
}

interface PendingOrder {
  id: number;
  internalOrderId: string;
  name: string;
  vendor: string;
  totalCost: number;
  costBreakdown: Record<string, number> | null;
  comments: string | null;
  user: User;
  subteam: string;
  createdAt: string;
  deliveryLocation: string | null;
  items: { id: number; name: string; quantity: number; price: number }[];
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Error fetching data');
  return res.json();
};

const ApprovalsComponent: React.FC = () => {
  const { data: session } = useSession();
  const { toast } = useToast();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadingActions, setLoadingActions] = useState<Record<number, string>>({});

  const userIsPM = session?.user?.email ? isPM(session.user.email) : false;

  useEffect(() => {
    if (session) {
      checkAdmin().then(setIsAdmin).catch(() => setIsAdmin(false));
    }
  }, [session]);

  const canApprove = userIsPM || isAdmin;

  const { data, error } = useSWR<{ orders: PendingOrder[] }>(
    '/api/orders/pending',
    fetcher,
    { refreshInterval: 15000 }
  );

  const handleApprove = async (orderId: number) => {
    setLoadingActions((prev) => ({ ...prev, [orderId]: 'approving' }));
    try {
      const res = await fetch('/api/orders/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      if (res.ok) {
        toast({
          title: 'Order Approved',
          description: 'The order has been approved and moved to the dashboard.',
          variant: 'affirmation',
        });
        mutate('/api/orders/pending');
        mutate('/api/orders');
        mutate((key) => typeof key === 'string' && key.startsWith('/api/finance'));
      } else {
        const err = await res.json();
        throw new Error(err.error);
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: (err as Error).message || 'Failed to approve order.',
        variant: 'destructive',
      });
    } finally {
      setLoadingActions((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }
  };

  const handleDeny = async (orderId: number) => {
    const confirmed = window.confirm(
      'Are you sure you want to deny this order? It will be permanently deleted.'
    );
    if (!confirmed) return;

    setLoadingActions((prev) => ({ ...prev, [orderId]: 'denying' }));
    try {
      const res = await fetch('/api/orders/deny', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      if (res.ok) {
        toast({
          title: 'Order Denied',
          description: 'The order has been denied and deleted.',
          variant: 'affirmation',
        });
        mutate('/api/orders/pending');
      } else {
        const err = await res.json();
        throw new Error(err.error);
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: (err as Error).message || 'Failed to deny order.',
        variant: 'destructive',
      });
    } finally {
      setLoadingActions((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }
  };

  const getExceededSubteams = (order: PendingOrder): string[] => {
    if (!order.costBreakdown) return [];
    const exceeded: string[] = [];
    for (const [subteam, percentage] of Object.entries(order.costBreakdown)) {
      if (percentage > 0) {
        const budget = SUBTEAM_BUDGETS[subteam];
        if (budget !== undefined) {
          exceeded.push(subteam);
        }
      }
    }
    return exceeded;
  };

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Pending Approvals</h1>
        </div>
        <div className={styles.errorState}>Error loading pending orders.</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Pending Approvals</h1>
        </div>
        <div className={styles.loadingState}>Loading...</div>
      </div>
    );
  }

  const orders = data.orders;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Pending Approvals</h1>
          <span className={styles.badge}>{orders.length}</span>
        </div>
        {!canApprove && (
          <p className={styles.viewOnlyBadge}>View Only</p>
        )}
      </div>

      {orders.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="32" cy="32" r="28" stroke="#E0E0E0" strokeWidth="2"/>
              <path d="M22 33L29 40L42 25" stroke="#44CF6C" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <p className={styles.emptyTitle}>All clear!</p>
          <p className={styles.emptyText}>No orders are waiting for approval.</p>
        </div>
      ) : (
        <div className={styles.orderList}>
          {orders.map((order) => {
            const affectedSubteams = getExceededSubteams(order);
            const isLoading = !!loadingActions[order.id];
            const loadingType = loadingActions[order.id];

            return (
              <div key={order.id} className={styles.orderCard}>
                <div className={styles.cardTop}>
                  <div className={styles.cardInfo}>
                    <h3 className={styles.orderName}>{order.name}</h3>
                    <div className={styles.orderMeta}>
                      <span className={styles.metaItem}>{order.vendor}</span>
                      <span className={styles.metaDot} />
                      <span className={styles.metaItem}>
                        ${order.totalCost.toFixed(2)}
                      </span>
                      <span className={styles.metaDot} />
                      <span className={styles.metaItem}>
                        {new Date(order.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className={styles.placedBy}>
                      Placed by <strong>{order.user.name}</strong> ({order.user.subteam})
                    </div>
                  </div>
                  {canApprove && (
                    <div className={styles.actionButtons}>
                      <button
                        className={styles.approveButton}
                        onClick={() => handleApprove(order.id)}
                        disabled={isLoading}
                      >
                        {loadingType === 'approving' ? 'Approving...' : 'Approve'}
                      </button>
                      <button
                        className={styles.denyButton}
                        onClick={() => handleDeny(order.id)}
                        disabled={isLoading}
                      >
                        {loadingType === 'denying' ? 'Denying...' : 'Deny'}
                      </button>
                    </div>
                  )}
                </div>

                <div className={styles.warningBanner}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={styles.warningIcon}>
                    <path d="M8 1L15 14H1L8 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                    <path d="M8 6V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <circle cx="8" cy="11.5" r="0.75" fill="currentColor"/>
                  </svg>
                  <span>
                    Over budget for:{' '}
                    <strong>{affectedSubteams.join(', ') || 'subteam(s)'}</strong>
                  </span>
                </div>

                {order.costBreakdown && (
                  <div className={styles.breakdownSection}>
                    <span className={styles.breakdownLabel}>Cost breakdown:</span>
                    <div className={styles.breakdownChips}>
                      {Object.entries(order.costBreakdown)
                        .filter(([, pct]) => pct > 0)
                        .map(([subteam, pct]) => (
                          <span
                            key={subteam}
                            className={`${styles.chip} ${
                              SUBTEAM_BUDGETS[subteam] !== undefined
                                ? styles.chipWarning
                                : ''
                            }`}
                          >
                            {subteam}: {pct}%
                            {pct > 0 && (
                              <span className={styles.chipAmount}>
                                (${((pct / 100) * order.totalCost).toFixed(2)})
                              </span>
                            )}
                          </span>
                        ))}
                    </div>
                  </div>
                )}

                {order.comments && (
                  <div className={styles.commentsSection}>
                    <span className={styles.commentsLabel}>Notes:</span>
                    <span className={styles.commentsText}>{order.comments}</span>
                  </div>
                )}

                {order.items.length > 0 && (
                  <div className={styles.itemsSection}>
                    <span className={styles.itemsLabel}>
                      Items ({order.items.length}):
                    </span>
                    <div className={styles.itemsList}>
                      {order.items.slice(0, 3).map((item) => (
                        <span key={item.id} className={styles.itemChip}>
                          {item.name} x{item.quantity}
                        </span>
                      ))}
                      {order.items.length > 3 && (
                        <span className={styles.itemChip}>
                          +{order.items.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ApprovalsComponent;
