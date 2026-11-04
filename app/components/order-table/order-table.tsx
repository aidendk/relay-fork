'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import styles from './order-table.module.css';
import OrderForm from '../order-form/order-form';
import { Item, ItemStatus, OrderStatus, StockLevel } from '@prisma/client';
import SettingsMenu from '../settings-component/settings';
import Settings from "../../../assets/settings.svg";
import LinkIcon from "../../../assets/link.svg";
import EmptyIcon from "../../../assets/empty.svg";
import SortIcon from "../../../assets/sort.svg"
import OpenURLIcon from "../../../assets/open_url.svg"
import ShareIcon from "../../../assets/share.svg";
import Image from 'next/image';
import useSWR, { mutate } from 'swr';
import { useSession } from 'next-auth/react';
import { Check } from 'lucide-react';
import { useToast } from '../toast/use-toast';

interface CostBreakdown {
    [key: string]: number;
}

interface Document {
    id: number;
    url: string;
    orderId: number;
    uploadedAt: string;
}

export interface SerializedOrderWithRelations {
    subteam: string;
    supportingDocs: Document[];
    id: number;
    internalOrderId: string;
    meenOrderId: string | null;
    name: string;
    userId: number;
    status: OrderStatus;
    vendor: string;
    totalCost: number;
    costVerified: boolean;
    comments: string | null;
    url: string | null;
    carrier: string | null;
    trackingId: string | null;
    costBreakdown: CostBreakdown | null;
    createdAt: Date | string;
    updatedAt: Date;
    user: {
        id: number;
        name: string;
        email: string;
        subteam: string;
        role: string;
        createdAt: string;
        updatedAt: Date;
    };
    items: SerializedItemsWithRelations[];
    deliveryLocation: string | null;
    deliveryPhotoUrl: string | null;
}

export interface SerializedItemsWithRelations {
    id: number;
    internalItemId: string;
    internalSKU: string | null;
    orderId: number;
    name: string;
    partNumber: string;
    notes: string | null;
    quantity: number;
    price: number;
    priceVerified: boolean;
    vendor: string;
    vendorSKU: string | null;
    link: string | null;
    status: ItemStatus;
    location: string | null;
    level: StockLevel | null;
    createdAt: Date;
    updatedAt: Date;
    deliveryPhotoUrl: string | null;
};

const PAGE_SIZE = 15;

const SUBTEAMS = [
    "AERODYNAMICS", "BATTERY", "CHASSIS", "ELECTRONICS", "POWERTRAIN", "SUSPENSION",
    "DISTRIBUTED BMS", "SOFTWARE", "VEHICLE DYNAMICS", "FINANCE", "OPERATIONS", "MARKETING",
];

const toTitleCase = (value: string) =>
    value.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bBms\b/, 'BMS');

const STATUS_CLASS: Partial<Record<OrderStatus, string>> = {
    TO_ORDER: styles.orderStatusToOrder,
    PLACED: styles.orderStatusPlaced, MEEN_PLACED: styles.orderStatusPlaced,
    MEEN_HOLD: styles.orderStatusMeenHold, HOLD: styles.orderStatusMeenHold,
    PROCESSED: styles.orderStatusProcessed, MEEN_RECEIVED: styles.orderStatusProcessed,
    SHIPPED: styles.orderStatusShipped, SUPPLIER_SHIPPED: styles.orderStatusShipped,
    AWAITING_PICKUP: styles.orderStatusAwaitingPickup, EV_AWAITING_PICKUP: styles.orderStatusAwaitingPickup,
    PARTIAL: styles.orderStatusPartial, PARTIAL_DELIVERY: styles.orderStatusPartial,
    DELIVERED: styles.orderStatusDelivered, MEEN_DELIVERED: styles.orderStatusDelivered,
};

const ITEM_STATUS_CLASS: Partial<Record<ItemStatus, string>> = {
    TO_ORDER: styles.orderStatusToOrder,
    PLACED: styles.orderStatusPlaced,
    PROCESSED: styles.orderStatusProcessed,
    DELIVERED: styles.orderStatusDelivered,
    PICKED_UP: styles.orderStatusDelivered,
};

const statusClass = (status: OrderStatus) => STATUS_CLASS[status] ?? styles.orderStatusDefault;
const itemStatusClass = (status: ItemStatus) => ITEM_STATUS_CLASS[status] ?? styles.orderStatusShipped;
const statusLabel = (status: string) => status.replace(/_/g, ' ');

const fetcher = async (url: string) => {
    const res = await fetch(url);
    return res.json();
};

const OrderTable: React.FC = () => {

    const [expandedOrderIds, setExpandedOrderIds] = useState<number[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [subteamFilter, setSubteamFilter] = useState('');
    const [showSubteamMenu, setShowSubteamMenu] = useState(false);
    const subteamMenuRef = useRef<HTMLDivElement>(null);
    const [showOrderForm, setShowOrderForm] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<SerializedOrderWithRelations | null>(null);
    const [selectedItem, setSelectedItem] = useState<Item | undefined>(undefined);
    const [showSettingsMenu, setShowSettingsMenu] = useState<boolean>(false);
    const [sortedColumn, setSortedColumn] = useState<string | null>(null);
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
    const [extraPages, setExtraPages] = useState<SerializedOrderWithRelations[][]>([]);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [total, setTotal] = useState(0);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();

    const { data: session } = useSession();
    const { toast } = useToast();
    const currentUserSubteam = session?.user?.subteam ?? "";

    // Close the subteam menu on outside click or Escape
    useEffect(() => {
        if (!showSubteamMenu) return;
        const handleClick = (e: MouseEvent) => {
            if (!subteamMenuRef.current?.contains(e.target as Node)) setShowSubteamMenu(false);
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setShowSubteamMenu(false);
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [showSubteamMenu]);

    const selectSubteam = (subteam: string) => {
        setSubteamFilter(subteam);
        setExtraPages([]);
        setShowSubteamMenu(false);
    };

    // Debounce search input
    useEffect(() => {
        debounceRef.current = setTimeout(() => {
            setDebouncedSearch(searchQuery);
            setExtraPages([]);  // reset pagination on new search
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [searchQuery]);

    const buildOrdersUrl = useCallback((offset: number) => {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (subteamFilter) params.set('subteam', subteamFilter);
        return `/api/orders?${params}`;
    }, [debouncedSearch, subteamFilter]);

    const apiUrl = buildOrdersUrl(0);

    const { data, error } = useSWR(apiUrl, fetcher, { refreshInterval: 60000 });

    // Track total / hasMore from first page
    useEffect(() => {
        if (data) {
            setTotal(data.total ?? 0);
            setHasMore(data.hasMore ?? false);
        }
    }, [data]);

    const firstPageOrders = useMemo(
        () => (data?.orders as SerializedOrderWithRelations[]) || [],
        [data]
    );

    const orders = useMemo(() => {
        return [...firstPageOrders, ...extraPages.flat()];
    }, [firstPageOrders, extraPages]);

    const loadMore = useCallback(async () => {
        const nextOffset = firstPageOrders.length + extraPages.flat().length;
        setLoadingMore(true);
        try {
            const res = await fetch(buildOrdersUrl(nextOffset));
            const json = await res.json();
            setExtraPages(prev => [...prev, json.orders]);
            setHasMore(json.hasMore ?? false);
        } catch (e) {
            console.error('Error loading more orders:', e);
        } finally {
            setLoadingMore(false);
        }
    }, [firstPageOrders.length, extraPages, buildOrdersUrl]);

    const refreshAllPages = useCallback(() => {
        // Re-fetch the first page via SWR
        mutate(apiUrl);
        mutate('/api/finance');
        // Clear extra pages so they get re-fetched fresh if user scrolls
        setExtraPages([]);
    }, [apiUrl]);

    const handleSort = (column: string) => {
        if (sortedColumn === column) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortedColumn(column);
            setSortOrder('asc');
        }
    };

    const displayOrders = useMemo(() => {
        let result = orders;

        if (sortedColumn) {
            result = result.slice().sort((a, b) => {
                let aValue = 0;
                let bValue = 0;
                if (sortedColumn === 'datePlaced') {
                    aValue = new Date(a.createdAt).getTime();
                    bValue = new Date(b.createdAt).getTime();
                } else if (sortedColumn === 'price') {
                    aValue = a.totalCost;
                    bValue = b.totalCost;
                }
                return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
            });
        }

        return result;
    }, [orders, sortedColumn, sortOrder]);

    const handleSettingsClick = (order: SerializedOrderWithRelations, item?: Item) => {
        if (item) {
            setSelectedItem(item);
        } else {
            setSelectedOrder(order);
        }
        setShowSettingsMenu(true);
    };

    const handleCloseSettingsMenu = () => {
        setSelectedOrder(null);
        setSelectedItem(undefined);
        setShowSettingsMenu(false);
    };

    const updateOrderInState = () => {
        refreshAllPages();
    };

    const toggleExpand = (orderId: number, orderItems: Item[], orderUrl: string | null) => {
        if (orderItems.length === 0 && orderUrl) {
            // Do nothing
        } else if (orderItems.length > 0) {
            setExpandedOrderIds((prev) =>
                prev.includes(orderId)
                    ? prev.filter((id) => id !== orderId)
                    : [...prev, orderId]
            );
        }
    };

    if (error) {
        return <div>Error loading orders.</div>;
    }

    const isLoading = !data;

    const skeletonRows = (
        <>
            {Array.from({ length: 8 }).map((_, i) => (
                <tr key={`skeleton-${i}`} className={styles.skeletonRow}>
                    <td className={styles.skeletonCell}><div className={styles.skeletonBlockNarrow} /></td>
                    <td className={styles.skeletonCell}><div className={styles.skeletonBlockWide} /></td>
                    <td className={styles.skeletonCell}><div className={styles.skeletonBlockWide} /></td>
                    <td className={styles.skeletonCell}><div className={styles.skeletonBlockNarrow} /></td>
                    <td className={styles.skeletonCell}><div className={styles.skeletonBlockNarrow} /></td>
                    <td className={styles.skeletonCell}><div className={styles.skeletonBlockNarrow} /></td>
                    <td className={styles.skeletonCell}><div className={styles.skeletonBlockStatus} /></td>
                    <td className={styles.skeletonCell}><div className={styles.skeletonBlockNarrow} /></td>
                    <td className={styles.skeletonCell}><div className={styles.skeletonBlockWide} /></td>
                    <td className={styles.skeletonCell}><div className={styles.skeletonBlockNarrow} /></td>
                    <td className={styles.skeletonCell}><div className={styles.skeletonBlockNarrow} /></td>
                </tr>
            ))}
        </>
    );

    const skeletonCards = (
        <>
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={`skeleton-card-${i}`} className={styles.skeletonCard}>
                    <div className={styles.skeletonCardHeader}>
                        <div className={styles.skeletonCardTitle} />
                        <div className={styles.skeletonCardAction} />
                    </div>
                    <div className={styles.skeletonCardMeta} />
                    <div className={styles.skeletonCardFooter} />
                </div>
            ))}
        </>
    );

    const handleStatusClick = (event: React.MouseEvent, order : SerializedOrderWithRelations) => {
        event.stopPropagation();

        if (order.carrier === "FEDEX" && order.trackingId) {
            window.open(`https://www.fedex.com/fedextrack/?trknbr=${order.trackingId}`, '_blank');
        } else if (order.carrier === "UPS" && order.trackingId) {
            window.open(`https://www.ups.com/track?loc=en_US&tracknum=${order.trackingId}&requester=WT/trackdetails`, '_blank');
        }
    };

    const handleShareOrder = (event: React.MouseEvent, orderId: number) => {
        event.stopPropagation();

        const shareUrl = `${window.location.origin}/order/${orderId}`;

        navigator.clipboard.writeText(shareUrl).then(() => {
            toast({ title: 'Link copied', description: 'Order link copied to clipboard.', variant: 'affirmation' });
        }).catch(() => {
            prompt('Copy this link to share:', shareUrl);
        });
    };

    // Export Orders handler
    const handleExportOrders = async () => {
        try {
            const res = await fetch('/api/orders/export');
            if (!res.ok) throw new Error('Failed to export orders');
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'orders.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            alert('Error exporting orders: ' + (err as Error).message);
        }
    };

    const handleMyOrders = () => {
        setSearchQuery(currentUserSubteam.toLowerCase());
    };

    const loadMoreButton = hasMore && !isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}>
            <button
                className={styles.myOrdersButton}
                onClick={loadMore}
                disabled={loadingMore}
                style={{ minWidth: 160 }}
            >
                {loadingMore ? 'Loading...' : `Load More (${orders.length} of ${total})`}
            </button>
        </div>
    );

    return (
        <div className={styles.tableMainContainer}>
            <div className={styles.tableTop}>
                <h1 className={styles.purchaseHeader}>Purchase Orders</h1>
                <div className={styles.tableSearch}>
                    <input
                        type="text"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className={styles.searchBar}
                    />
                    <div className={styles.subteamDropdown} ref={subteamMenuRef}>
                        <button
                            type="button"
                            className={`${styles.subteamFilter} ${showSubteamMenu ? styles.subteamFilterOpen : ''}`}
                            onClick={() => setShowSubteamMenu((open) => !open)}
                            aria-haspopup="listbox"
                            aria-expanded={showSubteamMenu}
                            aria-label="Filter by subteam"
                        >
                            {subteamFilter ? toTitleCase(subteamFilter) : 'All Subteams'}
                        </button>
                        {showSubteamMenu && (
                            <ul className={styles.subteamMenu} role="listbox" aria-label="Subteams">
                                {['', ...SUBTEAMS].map((subteam) => {
                                    const selected = subteam === subteamFilter;
                                    return (
                                        <li key={subteam || 'all'} role="option" aria-selected={selected}>
                                            <button
                                                type="button"
                                                className={`${styles.subteamOption} ${selected ? styles.subteamOptionSelected : ''}`}
                                                onClick={() => selectSubteam(subteam)}
                                            >
                                                {subteam ? toTitleCase(subteam) : 'All Subteams'}
                                                {selected && <Check size={14} />}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                    <button
                        className={styles.myOrdersButton}
                        onClick={handleMyOrders}
                    >
                        My Orders
                    </button>
                    <button
                        className={styles.orderButton}
                        onClick={() => setShowOrderForm(true)}
                    >
                        Place Order
                    </button>
                    <button
                        className={`${styles.orderButton} ${styles.exportButton}`}
                        onClick={handleExportOrders}
                    >
                        Export Orders
                    </button>
                </div>
            </div>
            {showOrderForm && <OrderForm onClose={() => { setShowOrderForm(false); refreshAllPages(); }} />}
            {showSettingsMenu && (
                <SettingsMenu
                    order={selectedOrder}
                    item={selectedItem}
                    onClose={handleCloseSettingsMenu}
                    onUpdateOrder={updateOrderInState}
                />
            )}
            {/* Desktop Table View */}
            <div className={styles.tableContainer}>
                <table className={styles.tableBody}>
                    <thead className={styles.tableHeader}>
                        <tr>
                            <th className={`${styles.thText} ${styles.idColumn}`}>ID</th>
                            <th
                                className={`${styles.thText} ${styles.datePlacedColumn} ${styles.sortableHeader}`}
                                onClick={() => handleSort('datePlaced')}
                            >
                                <span>Date Placed</span>
                                <Image
                                    src={SortIcon.src}
                                    height={10}
                                    width={10}
                                    alt="Sort Icon"
                                    className={`${styles.sortIcon} ${sortedColumn === 'datePlaced' && sortOrder === 'desc' ? styles.desc : styles.asc}`}
                                />
                            </th>
                            <th className={`${styles.thText}`}>Name</th>
                            <th className={`${styles.thText} ${styles.vendorColumn}`}>Vendor</th>
                            <th className={`${styles.thText} ${styles.linkColumn}`}>Link</th>
                            <th
                                className={`${styles.thText} ${styles.priceColumn} ${styles.sortableHeader}`}
                                onClick={() => handleSort('price')}
                            >
                                <span>Price</span>
                                <Image
                                    src={SortIcon.src}
                                    height={10}
                                    width={10}
                                    alt="Sort Icon"
                                    className={`${styles.sortIcon} ${sortedColumn === 'price' && sortOrder === 'desc' ? styles.desc : styles.asc}`}
                                />
                            </th>
                            <th className={`${styles.thText} ${styles.statusColumn}`}>Status</th>
                            <th className={`${styles.thText} ${styles.subteamColumn}`}>Subteam</th>
                            <th className={`${styles.commentsColumnHeader} ${styles.commentsColumn}`}>Comments</th>
                            <th className={`${styles.settingsCellHeader} ${styles.settingsColumn}`}></th>
                            <th className={`${styles.settingsCellHeader} ${styles.shareColumn}`}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? skeletonRows : displayOrders.map((order) => (
                            <React.Fragment key={order.id}>
                                <tr
                                    onClick={() => toggleExpand(order.id, order.items, order.url)}
                                    className={styles.order}
                                >
                                    <td className={`${styles.tdText} ${styles.idColumn}`}>
                                        {order.meenOrderId ? "#" + order.meenOrderId : "N/A"}
                                    </td>
                                    <td className={`${styles.tdText} ${styles.textColumn}`}>
                                        {new Date(order.createdAt).toLocaleDateString()}
                                    </td>
                                    <td className={`${styles.tdText} ${styles.nameColumn}`} title={order.name}>
                                        {order.name}
                                    </td>
                                    <td className={`${styles.tdText} ${styles.textColumn} ${styles.vendorColumn}`} title={order.vendor}>
                                        {order.vendor}
                                    </td>
                                    <td className={`${styles.tdText} ${styles.textColumn}`}>
                                        {order.url ? (
                                            <button
                                                className={styles.linkButton}
                                                aria-label="Open order link"
                                                title={order.url}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    window.open(order.url!, '_blank');
                                                }}
                                            >
                                                <Image
                                                    src={LinkIcon.src}
                                                    height={15}
                                                    width={15}
                                                    alt="link"
                                                />
                                            </button>
                                        ) : (
                                            'N/A'
                                        )}
                                    </td>
                                    <td className={`${styles.tdText} ${styles.textColumn} ${styles.priceColumn}`}>
                                        ${order.totalCost.toFixed(2)}
                                        {order.costVerified && (
                                            <Check className={styles.checkMark} size={14} aria-label="Price verified" />
                                        )}
                                    </td>
                                    <td className={`${styles.tdText} ${styles.statusColumn}`}>
                                        <span
                                            className={`${styles.statusPill} ${statusClass(order.status)}`}
                                            onClick={(event) => handleStatusClick(event, order)}
                                        >
                                            {statusLabel(order.status)}
                                            {order.status === OrderStatus.SHIPPED && order.trackingId && order.carrier &&
                                                <Image
                                                src={OpenURLIcon.src}
                                                height={12}
                                                width={12}
                                                alt="Track package"
                                                className={styles.openURLIcon}
                                                />
                                            }
                                        </span>
                                    </td>
                                    <td className={`${styles.tdText} ${styles.costBreakdownColumn}`}>
                                        {order.costBreakdown ? (
                                            <div className={styles.costBreakdownText}>
                                                {Object.entries(order.costBreakdown)
                                                    .filter(([, percentage]) => percentage > 0)
                                                    .map(([subteam, percentage]) => (
                                                        <div key={subteam} className={styles.breakdownItem}>
                                                            {subteam}: {percentage}%
                                                        </div>
                                                    ))}
                                            </div>
                                        ) : (
                                            'N/A'
                                        )}
                                    </td>
                                    <td className={`${styles.tdText} ${styles.commentsColumn}`} title={order.comments ?? undefined}>
                                        {order.comments || 'N/A'}
                                    </td>
                                    <td
                                        className={styles.settingsCell}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <button
                                            className={styles.settingsButton}
                                            aria-label="Order settings"
                                            title="Order settings"
                                            onClick={() => handleSettingsClick(order)}
                                        >
                                            <Image
                                                src={Settings.src}
                                                height={15}
                                                width={15}
                                                alt="settings"
                                            />
                                        </button>
                                    </td>
                                    <td
                                        className={styles.shareCell}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <button
                                            className={styles.shareButton}
                                            onClick={(e) => handleShareOrder(e, order.id)}
                                            title="Share order link"
                                            aria-label="Share order link"
                                        >
                                            <Image
                                                src={ShareIcon.src}
                                                height={15}
                                                width={15}
                                                alt="share"
                                            />
                                        </button>
                                    </td>
                                </tr>
                                {expandedOrderIds.includes(order.id) && (
                                    <tr>
                                        <td colSpan={11}>
                                            <div className={styles.expandedOrder}>
                                                {order.items.map((item) => (
                                                    <div
                                                        key={item.id}
                                                        className={styles.expandedOrderContent}
                                                    >
                                                        <div className={styles.itemLeftCol}>
                                                            <h4 title={item.name}>{item.name}</h4>
                                                            <p>{item.vendor}</p>
                                                            <p>${item.price.toFixed(2)}</p>
                                                        </div>
                                                        <div className={styles.itemRightCol}>
                                                            <span className={`${styles.statusPill} ${styles.itemStatusText} ${itemStatusClass(item.status)}`}>
                                                                {statusLabel(item.status)}
                                                            </span>
                                                            <button
                                                                className={styles.itemSettingsButton}
                                                                aria-label="Item settings"
                                                                onClick={() => handleSettingsClick(order, item)}
                                                            >
                                                                <Image src={Settings.src} height={15} width={15} alt="settings" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Mobile Card View */}
            <div className={styles.mobileCardList}>
                {isLoading ? skeletonCards : displayOrders.map((order) => (
                    <div
                        key={order.id}
                        className={styles.mobileCard}
                        onClick={() => toggleExpand(order.id, order.items, order.url)}
                    >
                        <div className={styles.mobileCardHeader}>
                            <div className={styles.mobileCardTitle}>
                                <span className={styles.mobileCardName}>{order.name}</span>
                                <span className={styles.mobileCardId}>
                                    {order.meenOrderId ? `#${order.meenOrderId}` : ''}
                                </span>
                            </div>
                            <div className={styles.mobileCardActions} onClick={(e) => e.stopPropagation()}>
                                <button
                                    className={styles.settingsButton}
                                    aria-label="Order settings"
                                    onClick={() => handleSettingsClick(order)}
                                >
                                    <Image src={Settings.src} height={16} width={16} alt="settings" />
                                </button>
                                <button
                                    className={styles.shareButton}
                                    aria-label="Share order link"
                                    onClick={(e) => handleShareOrder(e, order.id)}
                                >
                                    <Image src={ShareIcon.src} height={16} width={16} alt="share" />
                                </button>
                            </div>
                        </div>
                        <div className={styles.mobileCardMeta}>
                            <span>{order.vendor}</span>
                            <span className={styles.mobileCardDot}></span>
                            <span>${order.totalCost.toFixed(2)}{order.costVerified && <Check className={styles.checkMark} size={13} aria-label="Price verified" />}</span>
                            <span className={styles.mobileCardDot}></span>
                            <span>{new Date(order.createdAt).toLocaleDateString()}</span>
                        </div>
                        <div className={styles.mobileCardFooter}>
                            <span
                                className={`${styles.mobileCardStatus} ${statusClass(order.status)}`}
                                onClick={(event) => handleStatusClick(event, order)}
                            >
                                {statusLabel(order.status)}
                            </span>
                            {order.costBreakdown && (
                                <span className={styles.mobileCardSubteam}>
                                    {Object.entries(order.costBreakdown)
                                        .filter(([, p]) => p > 0)
                                        .map(([s]) => s)
                                        .join(', ')}
                                </span>
                            )}
                        </div>
                        {order.url && (
                            <button
                                className={styles.mobileCardLink}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(order.url!, '_blank');
                                }}
                            >
                                <Image src={LinkIcon.src} height={12} width={12} alt="link" />
                                <span>View Link</span>
                            </button>
                        )}
                        {expandedOrderIds.includes(order.id) && order.items.length > 0 && (
                            <div className={styles.mobileCardItems}>
                                {order.items.map((item) => (
                                    <div key={item.id} className={styles.mobileCardItem}>
                                        <div className={styles.mobileCardItemInfo}>
                                            <span className={styles.mobileCardItemName}>{item.name}</span>
                                            <span className={styles.mobileCardItemMeta}>
                                                {item.vendor} &middot; ${item.price.toFixed(2)}
                                            </span>
                                        </div>
                                        <div className={styles.mobileCardItemRight}>
                                            <span
                                                className={`${styles.mobileCardItemStatus} ${itemStatusClass(item.status)}`}
                                            >
                                                {statusLabel(item.status)}
                                            </span>
                                            <button
                                                className={styles.itemSettingsButton}
                                                aria-label="Item settings"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleSettingsClick(order, item);
                                                }}
                                            >
                                                <Image src={Settings.src} height={14} width={14} alt="settings" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
            {loadMoreButton}
            {!isLoading && displayOrders.length === 0 && (
            <div className={styles.emptyState}>
                <p>No active orders at the moment.</p>
                <p>Looks like everything is all set!</p>
                <Image
                    src={EmptyIcon.src}
                    height={100}
                    width={100}
                    alt="No orders"
                />
            </div>
        )}
        </div>
    );
};

export default OrderTable;
