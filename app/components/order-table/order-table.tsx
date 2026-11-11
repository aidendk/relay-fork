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
import { AlertTriangle, Check, ChevronDown, CircleHelp } from 'lucide-react';
import { useToast } from '../toast/use-toast';
import { SELECTABLE_ORDER_STATUSES, STATUS_EXPLANATION, statusLabel } from '../../lib/order-status';
import StatusAbout from '../status-about/status-about';

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
    carYear: string;
    trouble: boolean;
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
// The API's max page size; a status filter loads every match at once so groups are complete.
const GROUPED_PAGE_SIZE = 500;

// Statuses that show on the home screen, in the order an order moves through them.
// Archived orders live on their own page. Grouped views list groups in this order.
const STATUS_ORDER: OrderStatus[] = SELECTABLE_ORDER_STATUSES.filter(
    (status) => status !== OrderStatus.ARCHIVED,
);
const statusRank = (status: OrderStatus) => {
    const i = STATUS_ORDER.indexOf(status);
    return i === -1 ? STATUS_ORDER.length : i;
};

// Close a popover on a click outside its refs or on Escape.
function useDismiss(open: boolean, close: () => void, refs: React.RefObject<HTMLElement>[]) {
    useEffect(() => {
        if (!open) return;
        const handleClick = (e: MouseEvent) => {
            if (!refs.some((ref) => ref.current?.contains(e.target as Node))) close();
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    // refs are stable useRef objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, close]);
}

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
    const [statusFilter, setStatusFilter] = useState<OrderStatus[]>([]);
    const [showStatusMenu, setShowStatusMenu] = useState(false);
    const statusMenuRef = useRef<HTMLDivElement>(null);
    const mobileStatusMenuRef = useRef<HTMLDivElement>(null);
    const [troubleOnly, setTroubleOnly] = useState(false);
    const [showOrderForm, setShowOrderForm] = useState(false);
    const [showAbout, setShowAbout] = useState(false);
    const [statusTip, setStatusTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
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

    const closeSubteamMenu = useCallback(() => setShowSubteamMenu(false), []);
    const closeStatusMenu = useCallback(() => setShowStatusMenu(false), []);
    useDismiss(showSubteamMenu, closeSubteamMenu, [subteamMenuRef]);
    useDismiss(showStatusMenu, closeStatusMenu, [statusMenuRef, mobileStatusMenuRef]);

    // The table scrolls sideways, which would clip a menu inside its header, so the
    // header's status menu is fixed to the viewport under its button instead.
    const [statusMenuPos, setStatusMenuPos] = useState<{ top: number; left: number } | null>(null);
    const toggleStatusMenu = (e: React.MouseEvent<HTMLButtonElement>, fromHeader: boolean) => {
        if (fromHeader) {
            const rect = e.currentTarget.getBoundingClientRect();
            setStatusMenuPos({ top: rect.bottom + 6, left: rect.left });
        } else {
            setStatusMenuPos(null);
        }
        setShowStatusMenu((open) => !open);
    };

    // A fixed menu would drift from its button on scroll, so close it instead.
    useEffect(() => {
        if (!showStatusMenu || !statusMenuPos) return;
        const handleScroll = (e: Event) => {
            if (!statusMenuRef.current?.contains(e.target as Node)) setShowStatusMenu(false);
        };
        const handleResize = () => setShowStatusMenu(false);
        window.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', handleResize);
        };
    }, [showStatusMenu, statusMenuPos]);

    const selectSubteam = (subteam: string) => {
        setSubteamFilter(subteam);
        setExtraPages([]);
        setShowSubteamMenu(false);
    };

    const toggleStatus = (status: OrderStatus) => {
        setStatusFilter((prev) =>
            prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
        );
        setExtraPages([]);
    };

    const clearStatusFilter = () => {
        setStatusFilter([]);
        setExtraPages([]);
        setShowStatusMenu(false);
    };

    const toggleTroubleOnly = () => {
        setTroubleOnly((on) => !on);
        setExtraPages([]);
    };

    const isGrouped = statusFilter.length > 0;

    // Debounce search input
    useEffect(() => {
        debounceRef.current = setTimeout(() => {
            setDebouncedSearch(searchQuery);
            setExtraPages([]);  // reset pagination on new search
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [searchQuery]);

    const buildOrdersUrl = useCallback((offset: number) => {
        const limit = statusFilter.length ? GROUPED_PAGE_SIZE : PAGE_SIZE;
        const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (subteamFilter) params.set('subteam', subteamFilter);
        if (statusFilter.length) params.set('status', [...statusFilter].sort().join(','));
        if (troubleOnly) params.set('trouble', '1');
        return `/api/orders?${params}`;
    }, [debouncedSearch, subteamFilter, statusFilter, troubleOnly]);

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
        mutate((key) => typeof key === 'string' && key.startsWith('/api/finance'));
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

        // Grouped view: stable sort keeps the column sort inside each status group
        if (isGrouped) {
            result = result.slice().sort((a, b) => statusRank(a.status) - statusRank(b.status));
        }

        return result;
    }, [orders, sortedColumn, sortOrder, isGrouped]);

    const statusCounts: Partial<Record<OrderStatus, number>> = data?.statusCounts ?? {};
    const troubleCount: number = data?.troubleCount ?? 0;

    // In a grouped view, the number of displayed orders in each status, for the group headings.
    const groupSizes = useMemo(() => {
        const sizes: Partial<Record<OrderStatus, number>> = {};
        for (const order of displayOrders) sizes[order.status] = (sizes[order.status] ?? 0) + 1;
        return sizes;
    }, [displayOrders]);

    const startsGroup = (index: number) =>
        isGrouped && (index === 0 || displayOrders[index - 1].status !== displayOrders[index].status);

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

    const showStatusTip = (event: React.MouseEvent, status: OrderStatus) => {
        const text = STATUS_EXPLANATION[status];
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const below = rect.top < 88;
        const x = Math.min(window.innerWidth - 160, Math.max(160, rect.left + rect.width / 2));
        setStatusTip({ text, x, y: below ? rect.bottom + 8 : rect.top - 8, below });
    };

    useEffect(() => {
        if (!statusTip) return;
        const hide = () => setStatusTip(null);
        window.addEventListener('scroll', hide, true);
        window.addEventListener('resize', hide);
        return () => {
            window.removeEventListener('scroll', hide, true);
            window.removeEventListener('resize', hide);
        };
    }, [statusTip]);

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

    const statusFilterLabel =
        statusFilter.length === 0 ? 'All Statuses'
        : statusFilter.length === 1 ? toTitleCase(statusLabel(statusFilter[0]))
        : `${statusFilter.length} Statuses`;

    // One menu, rendered in the Status column header on desktop and in the toolbar on mobile.
    const renderStatusMenu = (inHeader: boolean) => showStatusMenu && (inHeader === !!statusMenuPos) && (
        <ul
            className={`${styles.subteamMenu} ${styles.statusMenu}`}
            style={inHeader && statusMenuPos ? {
                position: 'fixed',
                top: statusMenuPos.top,
                left: statusMenuPos.left,
                maxHeight: `calc(100vh - ${statusMenuPos.top + 16}px)`,
            } : undefined}
            role="listbox"
            aria-multiselectable="true"
            aria-label="Order statuses"
        >
            <li role="option" aria-selected={statusFilter.length === 0}>
                <button
                    type="button"
                    className={`${styles.subteamOption} ${statusFilter.length === 0 ? styles.subteamOptionSelected : ''}`}
                    onClick={clearStatusFilter}
                >
                    All Statuses
                    {statusFilter.length === 0 && <Check size={14} />}
                </button>
            </li>
            {STATUS_ORDER.map((status) => {
                const selected = statusFilter.includes(status);
                const count = statusCounts[status] ?? 0;
                return (
                    <li key={status} role="option" aria-selected={selected}>
                        <button
                            type="button"
                            className={`${styles.subteamOption} ${selected ? styles.subteamOptionSelected : ''} ${count === 0 && !selected ? styles.statusOptionEmpty : ''}`}
                            onClick={() => toggleStatus(status)}
                        >
                            <span className={`${styles.statusDot} ${statusClass(status)}`} aria-hidden />
                            <span className={styles.statusOptionLabel}>{toTitleCase(statusLabel(status))}</span>
                            <span className={styles.statusOptionCount}>{count}</span>
                            <span className={styles.statusOptionCheck}>{selected && <Check size={14} />}</span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );

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
                <div className={styles.titleRow}>
                    <h1 className={styles.purchaseHeader}>Purchase Orders</h1>
                    <button
                        type="button"
                        className={styles.aboutButton}
                        onClick={() => setShowAbout(true)}
                    >
                        <CircleHelp size={15} aria-hidden />
                        What do these statuses mean?
                    </button>
                </div>
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
                    <div className={`${styles.subteamDropdown} ${styles.mobileStatusDropdown}`} ref={mobileStatusMenuRef}>
                        <button
                            type="button"
                            className={`${styles.subteamFilter} ${showStatusMenu ? styles.subteamFilterOpen : ''}`}
                            onClick={(e) => toggleStatusMenu(e, false)}
                            aria-haspopup="listbox"
                            aria-expanded={showStatusMenu}
                            aria-label="Filter by status"
                        >
                            {statusFilterLabel}
                        </button>
                        {renderStatusMenu(false)}
                    </div>
                    <button
                        className={`${styles.myOrdersButton} ${styles.troubleFilter} ${troubleOnly ? styles.troubleFilterOn : ''}`}
                        onClick={toggleTroubleOnly}
                        aria-pressed={troubleOnly}
                        title="Show only orders flagged as trouble"
                    >
                        <AlertTriangle size={14} aria-hidden />
                        Trouble
                        <span className={styles.troubleCount}>{troubleCount}</span>
                    </button>
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
            {showAbout && <StatusAbout onClose={() => setShowAbout(false)} />}
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
                            <th className={`${styles.thText} ${styles.statusColumn} ${styles.statusHeader}`}>
                                <div className={styles.statusHeaderDropdown} ref={statusMenuRef}>
                                    <button
                                        type="button"
                                        className={`${styles.statusHeaderButton} ${statusFilter.length ? styles.statusHeaderButtonActive : ''}`}
                                        onClick={(e) => toggleStatusMenu(e, true)}
                                        aria-haspopup="listbox"
                                        aria-expanded={showStatusMenu}
                                        title="Filter and group by status"
                                    >
                                        {statusFilter.length ? statusFilterLabel : 'Status'}
                                        <ChevronDown size={12} aria-hidden />
                                    </button>
                                    {renderStatusMenu(true)}
                                </div>
                            </th>
                            <th className={`${styles.thText} ${styles.subteamColumn}`}>Subteam</th>
                            <th className={`${styles.commentsColumnHeader} ${styles.commentsColumn}`}>Comments</th>
                            <th className={`${styles.settingsCellHeader} ${styles.settingsColumn}`}></th>
                            <th className={`${styles.settingsCellHeader} ${styles.shareColumn}`}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? skeletonRows : displayOrders.map((order, index) => (
                            <React.Fragment key={order.id}>
                                {startsGroup(index) && (
                                    <tr className={styles.groupRow}>
                                        <td colSpan={11}>
                                            <span className={`${styles.statusPill} ${statusClass(order.status)}`}>{statusLabel(order.status)}</span>
                                            <span className={styles.groupCount}>{groupSizes[order.status]} {groupSizes[order.status] === 1 ? 'order' : 'orders'}</span>
                                        </td>
                                    </tr>
                                )}
                                <tr
                                    onClick={() => toggleExpand(order.id, order.items, order.url)}
                                    className={`${styles.order} ${order.trouble ? styles.troubleRow : ''}`}
                                    title={order.trouble ? 'Flagged as trouble: no update in a long time' : undefined}
                                >
                                    <td className={`${styles.tdText} ${styles.idColumn}`}>
                                        {order.trouble && <AlertTriangle className={styles.troubleIcon} size={14} aria-label="Trouble" />}
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
                                            onMouseEnter={(event) => showStatusTip(event, order.status)}
                                            onMouseLeave={() => setStatusTip(null)}
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
                {isLoading ? skeletonCards : displayOrders.map((order, index) => (
                    <React.Fragment key={order.id}>
                    {startsGroup(index) && (
                        <div className={styles.mobileGroupHeader}>
                            <span className={`${styles.mobileCardStatus} ${statusClass(order.status)}`}>{statusLabel(order.status)}</span>
                            <span className={styles.groupCount}>{groupSizes[order.status]}</span>
                        </div>
                    )}
                    <div
                        className={`${styles.mobileCard} ${order.trouble ? styles.mobileCardTrouble : ''}`}
                        onClick={() => toggleExpand(order.id, order.items, order.url)}
                    >
                        <div className={styles.mobileCardHeader}>
                            <div className={styles.mobileCardTitle}>
                                {order.trouble && (
                                    <span className={styles.mobileTroubleTag}>
                                        <AlertTriangle size={12} aria-hidden /> Trouble
                                    </span>
                                )}
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
                                title={STATUS_EXPLANATION[order.status]}
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
                    </React.Fragment>
                ))}
            </div>
            {loadMoreButton}
            {!isLoading && displayOrders.length === 0 && (
            <div className={styles.emptyState}>
                {statusFilter.length || troubleOnly || subteamFilter || debouncedSearch ? (
                    <p>No orders match these filters.</p>
                ) : (
                    <>
                        <p>No active orders at the moment.</p>
                        <p>Looks like everything is all set!</p>
                    </>
                )}
                <Image
                    src={EmptyIcon.src}
                    height={100}
                    width={100}
                    alt="No orders"
                />
            </div>
        )}
            {statusTip && (
                <div
                    className={`${styles.statusTip} ${statusTip.below ? styles.statusTipBelow : ''}`}
                    style={{ left: statusTip.x, top: statusTip.y }}
                    role="tooltip"
                >
                    {statusTip.text}
                </div>
            )}
        </div>
    );
};

export default OrderTable;
