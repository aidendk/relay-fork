"use client";

import React, { useState, useMemo } from 'react';
import styles from './archive-table.module.css';
import { OrderStatus, Item } from '@prisma/client';
import SettingsMenu from '../settings-component/settings';
import Settings from "../../../assets/settings.svg";
import LinkIcon from "../../../assets/link.svg";
import EmptyIcon from "../../../assets/empty.svg"
import Image from 'next/image';
import { SerializedOrderWithRelations } from '../order-table/order-table';
import useSWR, { mutate } from 'swr';

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json();
    const orders = data.orders.map((order: SerializedOrderWithRelations) => ({
        ...order,
        createdAt: new Date(order.createdAt),
        updatedAt: new Date(order.updatedAt),
        items: order.items.map((item) => ({
            ...item,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
        })),
        user: {
            ...order.user,
            createdAt: new Date(order.user.createdAt),
            updatedAt: new Date(order.user.updatedAt),
        },
    }));
    return { orders };
};

const subteamMapping: { [key: string]: string } = {
    AERO: 'Aerodynamics',
    CHS: 'Chassis',
    SUS: 'Suspension',
    BAT: 'Battery',
    ECE: 'Electronics',
    PT: 'Powertrain',
    SW: 'Software',
    DBMS: 'Distributed BMS',
    OPS: 'Operations',
    FACIL: 'Facilities/Infrastructure',
    FLEET: 'Fleet Maintenance',
    MKTG: 'Marketing',
    VD: 'Vehicle Dynamics',
};

const ArchiveTable: React.FC = () => {
    const [expandedOrderIds, setExpandedOrderIds] = useState<number[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedOrder, setSelectedOrder] = useState<SerializedOrderWithRelations | null>(null);
    const [selectedItem, setSelectedItem] = useState<Item | undefined>(undefined);
    const [showSettingsMenu, setShowSettingsMenu] = useState<boolean>(false);

    const { data, error } = useSWR('/api/orders/archived', fetcher, { refreshInterval: 60000 });

    const orders = useMemo(() => data?.orders as SerializedOrderWithRelations[] || [], [data]);

    const filteredOrders = useMemo(() => {
        if (searchQuery === '') {
            return orders;
        } else {
            const query = searchQuery.toLowerCase();
            return orders.filter((order) => {
                const involvedSubteams = Object.keys(order.costBreakdown || {}).filter(
                    (subteam) => (order.costBreakdown![subteam] || 0) > 0
                );

                const subteamNames = involvedSubteams.map((acronym) => ({
                    acronym: acronym.toLowerCase(),
                    fullName: (subteamMapping[acronym] || '').toLowerCase(),
                }));

                const matchesCostBreakdown = subteamNames.some(
                    ({ acronym, fullName }) =>
                        acronym.includes(query) || fullName.includes(query)
                );

                return (
                    order.name.toLowerCase().includes(query) ||
                    order.vendor.toLowerCase().includes(query) ||
                    order.status.toLowerCase().includes(query) ||
                    order.user.subteam.toLowerCase().includes(query) ||
                    (order.comments && order.comments.toLowerCase().includes(query)) ||
                    matchesCostBreakdown ||
                    order.items.some((item) =>
                        item.name.toLowerCase().includes(query) ||
                        item.vendor.toLowerCase().includes(query) ||
                        item.status.toLowerCase().includes(query)
                    )
                );
            });
        }
    }, [orders, searchQuery]);

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
        mutate('/api/orders/archived');
        mutate((key) => typeof key === 'string' && key.startsWith('/api/finance'));
    };

    const toggleExpand = (orderId: number, orderItems: SerializedOrderWithRelations['items'], orderUrl: string | null) => {
        if (orderItems.length === 0 && orderUrl) {
            return;
        } else if (orderItems.length > 0) {
            setExpandedOrderIds((prev) =>
                prev.includes(orderId)
                    ? prev.filter((id) => id !== orderId)
                    : [...prev, orderId]
            );
        }
    };

    if (error) {
        return <div>Error loading archived orders.</div>;
    }

    if (!data) {
        return <div>Loading archived orders...</div>;
    }

    return (
        <div className={styles.tableMainContainer}>
            <div className={styles.tableTop}>
                <h1 className={styles.purchaseHeader}>Archived Orders</h1>
                <div className={styles.tableSearch}>
                    <input
                        type="text"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className={styles.searchBar}
                    />
                </div>
            </div>
            {showSettingsMenu && (
                <SettingsMenu
                    order={selectedOrder}
                    item={selectedItem}
                    onClose={handleCloseSettingsMenu}
                    onUpdateOrder={updateOrderInState}
                />
            )}
            {/* Desktop Table */}
            <div className={styles.tableContainer}>
                <table className={styles.tableBody}>
                    <thead className={styles.tableHeader}>
                        <tr>
                            <th className={`${styles.thText} ${styles.idColumn}`}>ID</th>
                            <th className={`${styles.thText} ${styles.datePlacedColumn}`}>Date Placed</th>
                            <th className={`${styles.thText}`}>Name</th>
                            <th className={`${styles.thText} ${styles.vendorColumn}`}>Vendor</th>
                            <th className={`${styles.thText} ${styles.linkColumn}`}>Link</th>
                            <th className={`${styles.thText} ${styles.priceColumn}`}>Price</th>
                            <th className={`${styles.thText} ${styles.statusColumn}`}>Status</th>
                            <th className={`${styles.thText} ${styles.costBreakdownColumn}`}>Subteam</th>
                            <th className={`${styles.thText} ${styles.commentsColumnHeader} ${styles.commentsColumn}`}>Comments</th>
                            <th className={`${styles.settingsCellHeader} ${styles.settingsColumn}`}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredOrders.map((order) => (
                            <React.Fragment key={order.id}>
                                <tr
                                    onClick={() => toggleExpand(order.id, order.items, order.url)}
                                    className={styles.order}
                                >
                                    <td className={`${styles.tdText} ${styles.idColumn}`}>
                                        #{order.meenOrderId}
                                    </td>
                                    <td className={`${styles.tdText} ${styles.textColumn}`}>
                                        {new Date(order.createdAt).toLocaleDateString()}
                                    </td>
                                    <td className={`${styles.tdText} ${styles.nameColumn}`}>
                                        {order.name}
                                    </td>
                                    <td className={`${styles.tdText} ${styles.textColumn} ${styles.vendorColumn}`}>
                                        {order.vendor}
                                    </td>
                                    <td className={`${styles.tdText} ${styles.textColumn}`}>
                                        {order.url ? (
                                            <button
                                                className={styles.linkButton}
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
                                        ${order.totalCost.toFixed(2)}{' '}
                                        {order.costVerified && (
                                            <span className={styles.checkMark}>✓</span>
                                        )}
                                    </td>
                                    <td
                                        className={`${styles.tdText} ${
                                            order.status === OrderStatus.ARCHIVED || order.status === OrderStatus.EV_ARCHIVED
                                                ? styles.orderStatusArchived
                                                : styles.orderStatusDefault
                                        }`}
                                    >
                                        {order.status.toUpperCase()}
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
                                    <td className={`${styles.tdText} ${styles.commentsColumn}`}>
                                        {order.comments || 'N/A'}
                                    </td>
                                    <td
                                        className={styles.settingsCell}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <button
                                            className={styles.settingsButton}
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
                                </tr>
                                {expandedOrderIds.includes(order.id) && (
                                    <tr key={`expanded-${order.id}`}>
                                        <td colSpan={10}>
                                            <div className={styles.expandedOrder}>
                                                {order.items.map((item) => (
                                                    <div key={item.id} className={styles.expandedOrderContent}>
                                                        <div className={styles.itemLeftCol}>
                                                            <h4>{item.name.length > 18 ? item.name.slice(0, 18) + '...' : item.name}</h4>
                                                            <p>{item.vendor}</p>
                                                            <p>${item.price.toFixed(2)}</p>
                                                        </div>
                                                        <div className={styles.itemRightCol}>
                                                            <p className={`${styles.itemStatusText} ${styles.itemStatus} ${styles.itemStatusArchived}`}>
                                                                {item.status.toUpperCase()}
                                                            </p>
                                                            <button className={styles.itemSettingsButton} onClick={() => handleSettingsClick(order, item)}>
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
                {filteredOrders.map((order) => (
                    <div key={order.id} className={styles.mobileCard} onClick={() => toggleExpand(order.id, order.items, order.url)}>
                        <div className={styles.mobileCardHeader}>
                            <div className={styles.mobileCardTitle}>
                                <span className={styles.mobileCardName}>{order.name}</span>
                                <span className={styles.mobileCardId}>{order.meenOrderId ? `#${order.meenOrderId}` : ''}</span>
                            </div>
                            <button className={styles.settingsButton} onClick={(e) => { e.stopPropagation(); handleSettingsClick(order); }}>
                                <Image src={Settings.src} height={16} width={16} alt="settings" />
                            </button>
                        </div>
                        <div className={styles.mobileCardMeta}>
                            <span>{order.vendor}</span>
                            <span className={styles.mobileCardDot}></span>
                            <span>${order.totalCost.toFixed(2)}</span>
                            <span className={styles.mobileCardDot}></span>
                            <span>{new Date(order.createdAt).toLocaleDateString()}</span>
                        </div>
                        <div className={styles.mobileCardFooter}>
                            <span className={`${styles.mobileCardStatus} ${
                                order.status === OrderStatus.ARCHIVED || order.status === OrderStatus.EV_ARCHIVED ? styles.orderStatusArchived : styles.orderStatusDefault
                            }`}>{order.status.replace(/_/g, ' ')}</span>
                            {order.costBreakdown && (
                                <span className={styles.mobileCardSubteam}>
                                    {Object.entries(order.costBreakdown).filter(([, p]) => p > 0).map(([s]) => s).join(', ')}
                                </span>
                            )}
                        </div>
                        {expandedOrderIds.includes(order.id) && order.items.length > 0 && (
                            <div className={styles.mobileCardItems}>
                                {order.items.map((item) => (
                                    <div key={item.id} className={styles.mobileCardItem}>
                                        <div className={styles.mobileCardItemInfo}>
                                            <span className={styles.mobileCardItemName}>{item.name}</span>
                                            <span className={styles.mobileCardItemMeta}>{item.vendor} &middot; ${item.price.toFixed(2)}</span>
                                        </div>
                                        <div className={styles.mobileCardItemRight}>
                                            <span className={`${styles.mobileCardItemStatus} ${styles.itemStatusArchived}`}>{item.status.replace(/_/g, ' ')}</span>
                                            <button className={styles.itemSettingsButton} onClick={(e) => { e.stopPropagation(); handleSettingsClick(order, item); }}>
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
            {filteredOrders.length === 0 && (
                <div className={styles.emptyState}>
                    <p>No archived orders to show. 🎉</p>
                    <p>Looks like nothing&apos;s here!</p>
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

export default ArchiveTable;

// "schedule": "0 15 * * *"
